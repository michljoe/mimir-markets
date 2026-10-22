/**
 * Shared Stellar/Soroban configuration + `.env.local` bookkeeping for the deploy
 * tooling. Deliberately dependency-light: `deploy/deploy.ts`,
 * `scripts/stellar-keys.ts`, `scripts/verify-deployment.ts` and
 * `scripts/onchain-smoke.ts` all read the same source of truth from here.
 *
 * Nothing in this file touches `lib/` — the app-facing chain layer is a later
 * phase.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ── Network constants (Stellar public Testnet) ───────────────────────────────

export type StellarNetwork = "testnet" | "local";

export interface StellarNetworkConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  friendbotUrl: string;
}

const TESTNET_CONFIG: StellarNetworkConfig = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
};

const LOCAL_CONFIG: StellarNetworkConfig = {
  network: "local",
  networkPassphrase: "Standalone Network ; February 2017",
  horizonUrl: "http://localhost:8000",
  sorobanRpcUrl: "http://localhost:8000/soroban/rpc",
  friendbotUrl: "http://localhost:8000/friendbot",
};

/**
 * Resolve the active network config. `STELLAR_NETWORK=local` opts into the
 * `stellar/quickstart` local network; anything else (including unset) keeps
 * the public Testnet default.
 */
export function resolveNetworkConfig(
  network: string | undefined = process.env.STELLAR_NETWORK,
): StellarNetworkConfig {
  return network?.trim().toLowerCase() === "local" ? LOCAL_CONFIG : TESTNET_CONFIG;
}

const ACTIVE_CONFIG = resolveNetworkConfig();

export const NETWORK = ACTIVE_CONFIG.network;
export const NETWORK_PASSPHRASE = ACTIVE_CONFIG.networkPassphrase;
export const HORIZON_URL = ACTIVE_CONFIG.horizonUrl;
export const SOROBAN_RPC_URL = ACTIVE_CONFIG.sorobanRpcUrl;
export const FRIENDBOT_URL = ACTIVE_CONFIG.friendbotUrl;

/**
 * Circle's official Stellar Testnet USDC issuer. Verified against Horizon
 * directly: `home_domain: centre.io`, `auth_required: false`,
 * `auth_revocable: true`.
 */
export const USDC_CODE = "USDC";
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC_ASSET = `${USDC_CODE}:${USDC_ISSUER}`;

/** A Stellar Asset Contract exposes classic assets with 7 decimals. */
export const USDC_DECIMALS = 7;

/** Mirrors `contracts-soroban/mimir-market/src/types.rs::MIN_STAKE`. */
export const MIN_STAKE_ATOMIC = 2_0000000n;

/** Mirrors `types.rs::CHALLENGE_LOCK_SECONDS` — anti-sniping window. */
export const CHALLENGE_LOCK_SECONDS = 60;

/** Mirrors `types.rs::MAX_TOTAL_FEE_BPS` — the immutable 10% profit ceiling. */
export const MAX_TOTAL_FEE_BPS = 1_000;

// ── Env var names written by the deploy pipeline ──────────────────────────────

export const ENV_KEYS = {
  deployerSecret: "STELLAR_DEPLOYER_SECRET",
  deployerPublic: "STELLAR_DEPLOYER_PUBLIC",
  oracleSecret: "STELLAR_ORACLE_SECRET",
  oraclePublic: "STELLAR_ORACLE_PUBLIC",
  usdcSac: "NEXT_PUBLIC_STELLAR_USDC_SAC_ID",
  marketId: "NEXT_PUBLIC_STELLAR_MARKET_CONTRACT_ID",
  squadId: "NEXT_PUBLIC_STELLAR_SQUAD_CONTRACT_ID",
  network: "NEXT_PUBLIC_STELLAR_NETWORK",
  networkPassphrase: "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  rpcUrl: "NEXT_PUBLIC_STELLAR_RPC_URL",
  horizonUrl: "NEXT_PUBLIC_STELLAR_HORIZON_URL",
  usdcIssuer: "NEXT_PUBLIC_STELLAR_USDC_ISSUER",
  platformFeeBps: "STELLAR_PLATFORM_FEE_BPS",
  agentOwnerFeeBps: "STELLAR_AGENT_OWNER_FEE_BPS",
} as const;

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const ENV_LOCAL_PATH = path.join(REPO_ROOT, ".env.local");

// ── Pure `.env` file helpers (unit-tested in tests/node) ──────────────────────

/**
 * Parse a `.env`-style file body. Only what the deploy tooling needs: `KEY=VAL`
 * lines, optional `export ` prefix, optional surrounding quotes. Later
 * definitions win, matching dotenv's last-write behaviour.
 */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Merge `updates` into an existing `.env` body, rewriting keys in place and
 * appending the rest. Existing comments, ordering and unrelated keys survive.
 *
 * `updates` values of `undefined` are skipped, so callers can pass a partial
 * record without pruning.
 */
export function upsertEnvBody(
  body: string,
  updates: Record<string, string | undefined>,
  options: { header?: string } = {},
): string {
  const pending = new Map(
    Object.entries(updates).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const lines = body.length === 0 ? [] : body.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const match = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*=)/.exec(line);
    if (!match) return line;
    const key = match[2];
    if (!pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });

  if (pending.size > 0) {
    while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === "") rewritten.pop();
    if (rewritten.length > 0) rewritten.push("");
    if (options.header) rewritten.push(options.header);
    for (const [key, value] of pending) rewritten.push(`${key}=${value}`);
  }

  const result = rewritten.join("\n");
  return result.endsWith("\n") ? result : `${result}\n`;
}

// ── File-backed wrappers ─────────────────────────────────────────────────────

export function readEnvLocal(filePath = ENV_LOCAL_PATH): Record<string, string> {
  if (!existsSync(filePath)) return {};
  return parseEnvFile(readFileSync(filePath, "utf8"));
}

/** Write `updates` into `.env.local`, never clobbering unrelated keys. */
export function writeEnvLocal(
  updates: Record<string, string | undefined>,
  options: { filePath?: string; header?: string } = {},
): void {
  const filePath = options.filePath ?? ENV_LOCAL_PATH;
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, upsertEnvBody(existing, updates, { header: options.header }), "utf8");
}

/**
 * Resolve a config value from `process.env` first (so `--env-file` and CI
 * secrets win) and fall back to a direct `.env.local` read, which keeps every
 * script runnable via a bare `tsx scripts/foo.ts`.
 */
export function envValue(key: string, fallbackFile = ENV_LOCAL_PATH): string | undefined {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return stripInlineComment(fromProcess);
  const fromFile = readEnvLocal(fallbackFile)[key]?.trim();
  return fromFile ? stripInlineComment(fromFile) : undefined;
}

export function requireEnv(key: string, hint?: string): string {
  const value = envValue(key);
  if (!value) {
    throw new Error(`${key} is not set${hint ? ` — ${hint}` : ""}`);
  }
  return value;
}

/** `.env` files in this repo carry trailing `# comment` notes on some values. */
function stripInlineComment(value: string): string {
  return value.includes("#") ? value.split(/\s+#/)[0].trim() : value;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatAtomicUsdc(atomic: bigint | string | number): string {
  const value = BigInt(atomic);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function parseUsdcAtomic(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (frac.length > USDC_DECIMALS) throw new Error(`more than ${USDC_DECIMALS} decimals: ${amount}`);
  return BigInt(`${whole}${frac.padEnd(USDC_DECIMALS, "0")}`);
}

// ── Explorer links ───────────────────────────────────────────────────────────

export function explorerContractUrl(contractId: string): string {
  const network = NETWORK === "local" ? "testnet" : NETWORK;
  return `https://stellar.expert/explorer/${network}/contract/${contractId}`;
}

export function explorerAccountUrl(publicKey: string): string {
  const network = NETWORK === "local" ? "testnet" : NETWORK;
  return `https://stellar.expert/explorer/${network}/account/${publicKey}`;
}

export function explorerTxUrl(hash: string): string {
  const network = NETWORK === "local" ? "testnet" : NETWORK;
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}
