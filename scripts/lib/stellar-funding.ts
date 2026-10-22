/**
 * Shared funding primitives for the agent fleet.
 *
 * Extracted because `fund-agents`, `fund-traders`, `fund-yapper` and
 * `distribute-gas` all need the same three steps and the SDEX purchase is the one
 * piece with real subtlety (a moving orderbook and a slippage allowance) that must
 * not be re-derived three times.
 *
 * ── Why funding an agent looks nothing like it did on the EVM chain ──────────
 *
 * The old model was: one funder account holds all the gas and all the stake token,
 * and every script is a distribution loop from it. Two things about Stellar make
 * that model wrong rather than merely different:
 *
 *   1. **Friendbot.** A testnet account is created and given 10,000 XLM for free,
 *      with no auth, in one HTTP GET. There is no reason to route XLM through a
 *      funder that then has to be kept solvent itself — and a per-operation fee of
 *      ~0.00001 XLM means one Friendbot call covers an agent for the life of the
 *      deployment. "Distribute gas" is not an ongoing job; it is a one-time
 *      "does this account exist".
 *   2. **The SDEX has real USDC liquidity.** Testnet carries genuine XLM/USDC
 *      order books against Circle's issuer, so an account can convert its own
 *      Friendbot XLM into REAL `USDC:GBBD47…` — the same asset the market contract
 *      escrows — with a single `pathPaymentStrictReceive` to itself. No mock
 *      token, no captcha-gated faucet, and no funder to drain.
 *
 * So the shape is per-account and self-serve: exist, trust, buy. A funder is only
 * needed to move a balance that already exists somewhere specific (accumulated
 * fees on the oracle, say), which is what `fund-from-oracle.ts` is still for.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  FRIENDBOT_URL,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  USDC_CODE,
  USDC_ISSUER,
  explorerTxUrl,
} from "./stellar-env";

const USDC = new Asset(USDC_CODE, USDC_ISSUER);

/**
 * Minimal seam over the Horizon/Friendbot HTTP surface so tests can run offline.
 * Production uses the real `Horizon.Server` and global `fetch`.
 */
export interface FundingClient {
  loadAccount(publicKey: string): Promise<Horizon.AccountResponse>;
  submitTransaction(transaction: unknown): Promise<{ hash: string }>;
  fetch(input: string | URL): Promise<Response>;
}

const defaultClient: FundingClient = {
  loadAccount: (publicKey) => new Horizon.Server(HORIZON_URL).loadAccount(publicKey),
  submitTransaction: (transaction) =>
    new Horizon.Server(HORIZON_URL).submitTransaction(
      transaction as Parameters<Horizon.Server["submitTransaction"]>[0],
    ),
  fetch: (input) => fetch(input),
};

let client: FundingClient = defaultClient;

/** Swap the HTTP/Horizon client (tests only). Pass nothing to restore the default. */
export function setFundingClient(next?: FundingClient): void {
  client = next ?? defaultClient;
}

/**
 * Tolerance over the quoted spot price, so a moving orderbook does not fail the
 * transaction between the quote and the submit. Matches
 * `scripts/stellar-usdc-faucet.ts`.
 */
const SLIPPAGE = 1.5;

export interface AccountState {
  exists: boolean;
  /** Display XLM. 0 when the account does not exist. */
  xlm: number;
  /** Display USDC, or null when there is no trustline. */
  usdc: number | null;
}

export async function readAccount(publicKey: string): Promise<AccountState> {
  try {
    const account = await client.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === "native");
    const line = account.balances.find(
      (b) =>
        "asset_code" in b &&
        b.asset_code === USDC_CODE &&
        "asset_issuer" in b &&
        b.asset_issuer === USDC_ISSUER,
    );
    return {
      exists: true,
      xlm: native ? Number(native.balance) : 0,
      usdc: line ? Number(line.balance) : null,
    };
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      return { exists: false, xlm: 0, usdc: null };
    }
    throw error;
  }
}

/** Create the account from Friendbot if it does not exist yet. */
export async function ensureAccount(publicKey: string): Promise<"created" | "already-exists"> {
  const state = await readAccount(publicKey);
  if (state.exists) return "already-exists";

  const response = await client.fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    throw new Error(
      `friendbot ${response.status} for ${publicKey}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  await response.json().catch(() => undefined);
  return "created";
}

/**
 * Add the USDC trustline. Idempotent.
 *
 * A `changeTrust` does NOT need issuer authorization to submit — the line is
 * created either way. Whether it lands `authorized` depends on the issuer's
 * `auth_required` flag, which is OFF for Circle's testnet issuer (verified in
 * `scripts/stellar-keys.ts`), so the account can receive USDC immediately.
 */
export async function ensureTrustline(
  keypair: Keypair,
): Promise<"created" | "already-present"> {
  const state = await readAccount(keypair.publicKey());
  if (!state.exists) throw new Error(`${keypair.publicKey()} does not exist — fund it first`);
  if (state.usdc !== null) return "already-present";

  const account = await client.loadAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);
  await client.submitTransaction(transaction);
  return "created";
}

/** Ask Horizon what the SDEX will actually charge in XLM for `amount` USDC. */
export async function quoteXlmCost(amount: string): Promise<string> {
  const url = new URL(`${HORIZON_URL}/paths/strict-receive`);
  url.searchParams.set("source_assets", "native");
  url.searchParams.set("destination_asset_type", "credit_alphanum4");
  url.searchParams.set("destination_asset_code", USDC_CODE);
  url.searchParams.set("destination_asset_issuer", USDC_ISSUER);
  url.searchParams.set("destination_amount", amount);
  const response = await client.fetch(url);
  if (!response.ok) throw new Error(`horizon paths ${response.status}`);
  const body = (await response.json()) as {
    _embedded?: { records?: Array<{ source_amount: string }> };
  };
  const best = body._embedded?.records?.[0];
  if (!best) throw new Error(`no XLM→USDC path on testnet for ${amount} USDC`);
  return best.source_amount;
}

/** Convert this account's own XLM into real Circle testnet USDC via the SDEX. */
export async function buyUsdc(
  keypair: Keypair,
  amount: string,
): Promise<{ hash: string; spentXlm: string }> {
  const spot = await quoteXlmCost(amount);
  const sendMax = (Number(spot) * SLIPPAGE).toFixed(7);

  const account = await client.loadAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination: keypair.publicKey(),
        destAsset: USDC,
        destAmount: amount,
        path: [],
      }),
    )
    .setTimeout(120)
    .build();
  transaction.sign(keypair);
  const result = await client.submitTransaction(transaction);
  return { hash: result.hash, spentXlm: spot };
}

/**
 * Bring one account all the way up: exists, trusts USDC, holds `targetUsdc`.
 *
 * Idempotent at every step, so re-running is cheap and safe — an account already
 * at target costs three reads and no transaction.
 */
export async function provisionAccount(args: {
  label: string;
  keypair: Keypair;
  targetUsdc: number;
  /** Below this fraction of the target, top up. Above it, leave alone. */
  topUpBelow?: number;
  log?: (line: string) => void;
}): Promise<{ funded: boolean; trustlineAdded: boolean; boughtUsdc: number }> {
  const log = args.log ?? ((line: string) => console.log(line));
  const publicKey = args.keypair.publicKey();

  const created = await ensureAccount(publicKey);
  if (created === "created") log(`    ✓ created + funded by friendbot`);

  const trustline = await ensureTrustline(args.keypair);
  if (trustline === "created") log(`    ✓ USDC trustline added`);

  const state = await readAccount(publicKey);
  const held = state.usdc ?? 0;
  const threshold = args.targetUsdc * (args.topUpBelow ?? 0.5);
  if (held >= threshold) {
    log(`    · USDC ok (${held.toFixed(4)} of ${args.targetUsdc} target)`);
    return { funded: created === "created", trustlineAdded: trustline === "created", boughtUsdc: 0 };
  }

  const needed = args.targetUsdc - held;
  // 7 decimals: `pathPaymentStrictReceive`'s destAmount is a classic asset amount,
  // and Stellar rejects an eighth decimal place outright.
  const { hash, spentXlm } = await buyUsdc(args.keypair, needed.toFixed(7));
  log(`    ✓ bought ${needed.toFixed(4)} USDC for ~${Number(spentXlm).toFixed(4)} XLM — ${explorerTxUrl(hash)}`);
  return {
    funded: created === "created",
    trustlineAdded: trustline === "created",
    boughtUsdc: needed,
  };
}
