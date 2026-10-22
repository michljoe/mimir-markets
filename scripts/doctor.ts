/**
 * Environment doctor.
 *
 * Diagnoses a local `.env.local` before running workers or the web app.
 *
 * Usage:
 *   npx tsx scripts/doctor.ts
 *
 * The checker is pure (takes an in-memory env object) so it can be unit tested.
 * No secret value is ever printed -- only key names and statuses.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type Status = "pass" | "warn" | "fail";

export interface CheckResult {
  group: string;
  key: string;
  status: Status;
  message: string;
}

export type Env = Record<string, string | undefined>;

/** Stellar networks and their expected passphrases. */
const NETWORK_PASSEPHRASES: Record<string, string> = {
  testnet: "Test Stellar Network ; September 2015",
  mainnet: "Public Global Network ; September 2015",
  futurenet: "Test Stellar Network ; September 2015",
};

/** Secret keys start with `S. Public addresses start with `G. */
const SECRET_PREFIX = "S";
const ADDRESS_PREFIX = "G";

const SECRET_KEY_PATTERN = /SECRET$/;
const ADDRESS_KEY_PATTERN = /ADDRESS$/;

function isEmpty(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

function checkRequired(env: Env, key: string, group: string): CheckResult {
  if (isEmpty(env[key])) {
    return { group, key, status: "fail", message: "missing" };
  }
  return { group, key, status: "pass", message: "set" };
}

function checkOneOf(env: Env, keys: string[], group: string): CheckResult {
  if (keys.some((k) => !isEmpty(env[k]))) {
    return { group, key: keys.join(" | "), status: "pass", message: "one set" };
  }
  return {
    group,
    key: keys.join(" | "),
    status: "fail",
    message: "none set",
  };
}

/** Validate the shape of a Stellar secret key without echoing it. */
function checkSecretShape(env: Env, key: string, group: string): CheckResult {
  const v = env[key];
  if (isEmpty(v)) {
    return { group, key, status: "fail", message: "missing" };
  }
  if (!v!.startsWith(SECRET_PREFIX)) {
    return {
      group,
      key,
      status: "fail",
      message: `secret must start with "${SECRET_PREFIX}" `,
    };
  }
  if (v!.length !== 56) {
    return { group, key, status: "warn", message: "unexpected secret length" };
  }
  return { group, key, status: "pass", message: "valid secret shape" };
}

/** Validate the shape of a Stellar public address without echoing it. */
function checkAddressShape(env: Env, key: string, group: string): CheckResult {
  const v = env[key];
  if (isEmpty(v)) {
    return { group, key, status: "fail", message: "missing" };
  }
  if (v!.startsWith(SECRET_PREFIX)) {
    return {
      group,
      key,
      status: "fail",
      message: `address must not be a secret (starts with "${SECRET_PREFIX}")`,
    };
  }
  if (!v!.startsWith(ADDRESS_PREFIX)) {
    return {
      group,
      key,
      status: "fail",
      message: `address must start with "${ADDRESS_PREFIX}"`,
    };
  }
  if (v!.length !== 56) {
    return { group, key, status: "warn", message: "unexpected address length" };
  }
  return { group, key, status: "pass", message: "valid address shape" };
}

/** Check that STELLAR_NETWORK matches the configured passphrase. */
function checkNetworkConsistency(env: Env, group: string): CheckResult[] {
  const results: CheckResult[] = [];
  const network = env.STELLAR_NETWORK;
  const passphrase = env.STELLAR_NETWORK_PASSPHRASE;

  if (isEmpty(network)) {
    results.push({ group, key: "STELLAR_NETWORK", status: "fail", message: "missing" });
    return results;
  }

  const normalized = network!.trim().toLowerCase();
  const expected = NETWORK_PASSEPHRASES[normalized];
  if (!expected) {
    results.push({
      group,
      key: "STELLAR_NETWORK",
      status: "fail",
      message: `unknown network (${normalized})`,
    });
    return results;
  }

  results.push({ group, key: "STELLAR_NETWORK", status: "pass", message: normalized });

  if (isEmpty(passphrase)) {
    results.push({
      group,
      key: "STELLAR_NETWORK_PASSMBRPASE",
      status: "fail",
      message: "missing",
    });
    return results;
  }

  if (passphrase !== expected) {
    results.push({
      group,
      key: "STELLAR_NETWORK_PASSPHRASE",
      status: "fail",
      message: `mismatch for network "${normalized}"`,
    });
    return results;
  }

  results.push({
    group,
    key: "STELLAR_NETWORK_PASSPHRASE",
    status: "pass",
    message: "matches network",
  });
  return results;
}

/** Check that a secret-shaped key is not accidentally set in an address variable. */
function checkSeedInAddress(env: Env, group: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!ADDRESS_KEY_PATTERN.test(key)) continue;
    if (isEmpty(value)) continue;
    if (value!.startsWith(SECRET_PREFIX)) {
      results.push({
        group,
        key,
        status: "fail",
        message: `seed ("${SECRET_PREFIX}") in address variable`,
      });
    }
  }
  return results;
}

/** Check that an address-shaped key is not accidentally set in a secret variable. */
function checkAddressInSecret(env: Env, group: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_KEY_PATTERN.test(key)) continue;
    if (isEmpty(value)) continue;
    if (value!.startsWith(ADDRESS_PREFIX)) {
      results.push({
        group,
        key,
        status: "fail",
        message: `address ("${ADDRESS_PREFIX}") in secret variable`,
      });
    }
  }
  return results;
}

/** Run all checks against an in-memory env object. */
export function runDoctor(env: Env): CheckResult[] {
  const results: CheckResult[] = [];

  // --- Web ---
  const web = "web";
  results.push(checkRequired(env, "NEXT_PUBLIC_APP_URL", web));
  results.push(checkRequired(env, "SUPPBASE_URL", web));
  results.push(checkRequired(env, "SUPPBASE_ANON_KEY", web));
  results.push(...checkNetworkConsistency(env, web));

  // --- Worker: agent ---
  const agent = "worker:agent";
  results.push(checkRequired(env, "DRIVING_PUBLIC_KEY", agent));
  results.push(checkSecretShape(env, "DRIVING_SECRET_KEY", agent));
  results.push(checkRequired(env, "AGENT_CONTRACT_ID", agent));
  results.push(checkOneOf(env, ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"], agent));

  // --- Worker: escrow ---
  const escrow = "worker:escrow";
  results.push(checkRequired(env, "ESCROW_CONTRACT_ID", escrow));
  results.push(checkAddressShape(env, "ESCROW_ADDRESS", escrow));
  results.push(checkSecretShape(env, "ESCROW_SECRET", escrow));

  // --- Worker: x402 ---
  const x402 = "x402";
  results.push(checkRequired(env, "X402_PAY_TO_ADDRESS", x402));
  results.push(checkAddressShape(env, "X402_PAY_TO_ADDRESS", x402));
  results.push(checkRequired(env, "X402_FACILITATOR_URL", x402));
  results.push(checkRequired(env, "X402_NETWORK", x402));

  // --- Shared secrets ---
  const shared = "shared";
  results.push(checkRequired(env, "PASS_SECRET", shared));
  results.push(...checkSeedInAddress(env, shared));
  results.push(...checkAddressInSecret(env, shared));

  return results;
}

/** Parse a dotenv file into a plain object. Minimal parser to avoid extra dependencies. */
export function parseDotenv(content: string): Env {
  const env: Env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** Render results as a pass/warn/fail table. Never prints values. */
export function formatResults(columns: CheckResult[]): string {
  const label: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const header = ["GROUP", "KEY", "STATUS", "DETAIL"];
  const rows = columns.map((c) => [c.group, c.key, label[c.status], c.message]);
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const formatRow = (r: string[]) =>
    r.map((cell, i) => cell.padEnd(widths[i])).join("  ").replace(/\s+$/, "");
  const lines = [formatRow(header), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of rows) lines.push(formatRow(r));
  return lines.join("\n");
}

export function hasFailures(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

function main(argv: string[]): void {
  const explicit = argv.find((a) => a.startsWith("--env="));
  const envPath = explicit
    ? resolve(process.cwd(), explicit.slice("--env=".length))
    : resolve(process.cwd(), ".env.local");

  if (!existsSync(envPath)) {
    console.error(`[doctor] env file not found: ${envPath}`);
    console.error("[doctor] copy .env.example to .env.local and fill in the required values.");
    process.exitCode = 1;
    return;
  }

  const env = parseDotenv(readFileSync(envPath, "utf-8"));
  const results = runDoctor(env);

  console.log(`[doctor] checking ${envPath}\n`);
  console.log(formatResults(results));

  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  console.log(`\n[doctor] ${fails} failure(s), ${warns} warning(s)`);

  if (hasFailures(results)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}
