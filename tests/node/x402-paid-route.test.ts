/**
 * Tests for lib/x402/server.ts — the branches of `paidRoute` that decide
 * whether a request ever reaches a handler, and what happens to a payment when
 * the handler it paid for then fails.
 *
 * Four cases, all offline:
 *
 *   1. selling paused     → 503 + Retry-After, handler never called (and never
 *                           a 402: a paying agent must not be invited to pay a
 *                           seller that cannot verify).
 *   2. skipPayment true   → the handler runs as-is, with no paywall in front of
 *                           it (a valid council pass).
 *   3. handler ≥ 400      → the verified payment is NOT settled: no replay claim
 *                           on the transaction hash, no ledger row.
 *   4. paymentPayer       → the payer is read back out of PAYMENT-SIGNATURE,
 *                           exactly as it appears, and null on anything absent
 *                           or malformed.
 *
 * ── How this runs without a network ──────────────────────────────────────────
 *
 * The x402 stack under test is the real one: `withX402`, the resource server,
 * the paywall quote, verification, settlement and the `onAfterSettle` ledger
 * hook are all `@x402` / `lib/x402` code. Only two seams are replaced:
 *
 *   - `server-only`, which throws outside Next.js, resolves to a no-op;
 *   - `createHorizonServer()`, the one call that would read the ledger, returns
 *     an in-memory Horizon backed by `./x402-fixtures`.
 *
 * So a "paid request" here carries a genuinely signed proof checked against a
 * landed payment — it simply lands in the fixture ledger instead of Testnet.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { NextRequest, NextResponse } from "next/server";

import type { HorizonPaymentOperation } from "../../lib/x402/stellar-scheme";

// ── Seams ────────────────────────────────────────────────────────────────────

/** One landed payment, as the fixture ledger stores it. */
interface FixtureLedgerRecord {
  createdAtMs: number;
  successful: boolean;
  operations: HorizonPaymentOperation[];
}

const ledger = new Map<string, FixtureLedgerRecord>();

/**
 * A Horizon that answers from memory, shaped exactly like the two reads
 * `horizonPaymentReader()` performs: `transactions().transaction(hash).call()`
 * and `operations().forTransaction(hash).limit(200).call()`.
 *
 * A missing hash throws the `{ response: { status: 404 } }` the scheme
 * distinguishes as `transaction_not_found`, so a refusal that is not the code's
 * own fault still fails the way production would report it.
 */
function inMemoryHorizon() {
  const read = (hash: string): FixtureLedgerRecord => {
    const record = ledger.get(hash.toLowerCase());
    if (!record) {
      const missing: Error & { response?: { status: number } } = new Error(
        `transaction ${hash} is not in the fixture ledger`,
      );
      missing.response = { status: 404 };
      throw missing;
    }
    return record;
  };
  return {
    transactions: () => ({
      transaction: (hash: string) => ({
        call: async () => {
          const record = read(hash);
          return {
            successful: record.successful,
            created_at: new Date(record.createdAtMs).toISOString(),
          };
        },
      }),
    }),
    operations: () => ({
      forTransaction: (hash: string) => ({
        limit: () => ({
          // The Stellar SDK unwraps `_embedded` and resolves to the page object
          // itself — `horizonPaymentReader()` reads `page.records`.
          call: async () => ({ records: read(hash).operations }),
        }),
      }),
    }),
  };
}

const STELLAR_SCHEME_PATH = path.resolve(__dirname, "../../lib/x402/stellar-scheme.ts");

/**
 * Installed before anything under `lib/` loads: `server-only` has to be inert
 * for the module under test to import at all, and `stellar-scheme.ts` has to
 * bind `createHorizonServer` to the fixture while it is still evaluating.
 */
function installSeams(): void {
  // `node:module`'s `_load` is what every `require()` funnels through, and the
  // typings for it are not published — hence the local shape.
  const loader = require("node:module") as {
    _load(request: string, parent: NodeModule | undefined, isMain: boolean): unknown;
  };
  const originalLoad = loader._load;
  loader._load = function loadWithSeams(
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
  ): unknown {
    if (request === "server-only") return {};
    if (request === "../stellar" && parent?.filename === STELLAR_SCHEME_PATH) {
      const stellar = originalLoad.call(this, request, parent, isMain) as typeof import("../../lib/stellar");
      return { ...stellar, createHorizonServer: inMemoryHorizon as unknown as typeof stellar.createHorizonServer };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

installSeams();

// Loaded after the seams — each of these reaches lib/x402/stellar-scheme.
const { paidRoute, paymentPayer } = require("../../lib/x402/server") as typeof import("../../lib/x402/server");
const {
  consumedSettlementsCount,
  isSettlementConsumed,
  resetConsumedSettlements,
} = require("../../lib/x402/stellar-scheme") as typeof import("../../lib/x402/stellar-scheme");
const { getRevenueSummary } = require("../../lib/paid-revenue") as typeof import("../../lib/paid-revenue");
const {
  FIXTURE_PAYER,
  FIXTURE_SELLER_PUBLIC,
  makeRequirements,
  nextTxHash,
  signedProof,
  toPaymentPayload,
} = require("./x402-fixtures") as typeof import("./x402-fixtures");

// The seller every quote here pays into — `sellerAddress()` throws without one,
// which would turn every expected 402 into an unexplained 500.
process.env.SELLER_ADDRESS = FIXTURE_SELLER_PUBLIC;

const ROUTE = "/api/premium/price?symbol=btc";
const PAUSE_ENV = "MIMIR_PAUSE_X402_SELLING";
const PAUSE_REASON_ENV = "MIMIR_PAUSE_X402_SELLING_REASON";

type Route = (req: NextRequest) => Promise<NextResponse<unknown>>;

function makeRequest(url = ROUTE, init: { headers?: HeadersInit } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", "203.0.113.7");
  return new NextRequest(`http://localhost${url}`, { method: "GET", headers });
}

/** The 402 a paywall answers an unpaid request with, and its quote. */
async function quote(route: Route): Promise<PaymentRequirements> {
  const response = await route(makeRequest());
  assert.equal(response.status, 402, "an unpaid request must be refused by the paywall");
  const header = response.headers.get("payment-required");
  assert.ok(header, "the 402 must carry a PAYMENT-REQUIRED quote");
  const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    accepts?: PaymentRequirements[];
  };
  const accept = parsed.accepts?.[0];
  assert.ok(accept, "the quote carries no accepts");
  return accept;
}

/** Land a fixture payment for `accept` and sign the proof a buyer would send. */
function stagePayment(accept: PaymentRequirements): { transaction: string; header: string } {
  const transaction = nextTxHash();
  const proof = signedProof(transaction, accept);
  const [assetCode, assetIssuer] = accept.asset.split(":");
  ledger.set(transaction.toLowerCase(), {
    createdAtMs: Date.now() - 2_000,
    successful: true,
    operations: [
      {
        type: "payment",
        from: proof.payer,
        to: accept.payTo,
        asset_type: "credit_alphanum4",
        asset_code: assetCode,
        asset_issuer: assetIssuer,
        amount: (Number(BigInt(accept.amount)) / 10_000_000).toFixed(7),
        transaction_successful: true,
      },
    ],
  });
  return {
    transaction,
    header: encodePaymentSignatureHeader(toPaymentPayload(proof, accept)),
  };
}

function paidRequest(header: string): NextRequest {
  return makeRequest(ROUTE, { headers: { "payment-signature": header } });
}

// ── 1. the kill switch ───────────────────────────────────────────────────────

test("selling paused: 503 with Retry-After, the handler never runs", async () => {
  process.env[PAUSE_ENV] = "1";
  process.env[PAUSE_REASON_ENV] = "Horizon is unreachable";
  try {
    let calls = 0;
    const route = paidRoute("premiumPrice", async () => {
      calls += 1;
      return NextResponse.json({ price_usd: 1 });
    });

    const response = await route(makeRequest());

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    const body = (await response.json()) as { error?: string; detail?: string };
    assert.equal(body.error, "paid endpoints are temporarily unavailable");
    assert.equal(body.detail, "Horizon is unreachable");
    assert.equal(calls, 0, "the handler must not run while selling is paused");
    // 503 rather than 402: a buyer must not be invited to pay.
    assert.equal(response.headers.get("payment-required"), null);
  } finally {
    delete process.env[PAUSE_ENV];
    delete process.env[PAUSE_REASON_ENV];
  }
});

// ── 2. skipPayment (a council pass) ──────────────────────────────────────────

test("skipPayment: the handler runs untouched, with no 402 in front of it", async () => {
  const seen: NextRequest[] = [];
  const route = paidRoute(
    "councilReasoning",
    async (req) => {
      seen.push(req);
      return NextResponse.json({ reasoning: "fixture" });
    },
    { skipPayment: async () => true },
  );

  const response = await route(makeRequest("/api/council/reasoning?claimId=12"));

  assert.equal(response.status, 200);
  assert.equal(seen.length, 1, "the handler must run exactly once");
  assert.equal(seen[0].nextUrl.pathname, "/api/council/reasoning");
  assert.equal(response.headers.get("payment-required"), null, "no paywall header on a pass");
  assert.deepEqual(await response.json(), { reasoning: "fixture" });
});

test("skipPayment false: the same route still hits the paywall", async () => {
  let calls = 0;
  const route = paidRoute(
    "councilReasoning",
    async () => {
      calls += 1;
      return NextResponse.json({ reasoning: "fixture" });
    },
    { skipPayment: () => false },
  );

  const response = await route(makeRequest("/api/council/reasoning?claimId=12"));

  assert.equal(response.status, 402);
  assert.equal(calls, 0, "the paywall must refuse before the handler runs");
});

// ── 3. a handler that fails must not take the payment ────────────────────────

test("handler ≥ 400: the verified payment is never settled", async () => {
  resetConsumedSettlements();
  const revenueBefore = (await getRevenueSummary()).totalCalls;

  const route = paidRoute("premiumPrice", async () =>
    NextResponse.json({ error: "upstream exploded" }, { status: 500 }),
  );
  const accept = await quote(route);
  const { transaction, header } = stagePayment(accept);

  const response = await route(paidRequest(header));

  assert.equal(response.status, 500, "the handler's own status is what the buyer sees");
  assert.equal(
    consumedSettlementsCount(),
    0,
    "a failed handler must not claim the transaction hash for replay",
  );
  assert.equal(
    await isSettlementConsumed(accept.network, transaction),
    false,
    "the payment must stay payable — the buyer got nothing for it",
  );
  const revenue = await getRevenueSummary();
  assert.equal(revenue.totalCalls, revenueBefore, "no ledger row for a response that failed");
});

test("handler < 400: the same proof settles and is booked once", async () => {
  resetConsumedSettlements();
  const revenueBefore = (await getRevenueSummary()).totalCalls;

  const route = paidRoute("premiumPrice", async () => NextResponse.json({ price_usd: 1 }));
  const accept = await quote(route);
  const { transaction, header } = stagePayment(accept);

  const response = await route(paidRequest(header));

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("payment-response"), "a settled response reports the settlement");
  assert.equal(consumedSettlementsCount(), 1);
  assert.equal(await isSettlementConsumed(accept.network, transaction), true);

  const revenue = await getRevenueSummary();
  assert.equal(revenue.totalCalls, revenueBefore + 1);
  const booked = revenue.recent[0];
  assert.equal(booked?.transactionHash, transaction);
  assert.equal(booked?.payer, FIXTURE_PAYER.publicKey());
});

// ── 4. paymentPayer ──────────────────────────────────────────────────────────

test("paymentPayer reads the payer out of PAYMENT-SIGNATURE", () => {
  const accept = makeRequirements();
  const proof = signedProof(nextTxHash(), accept);
  const header = encodePaymentSignatureHeader(toPaymentPayload(proof, accept));

  assert.equal(paymentPayer(makeRequest(ROUTE, { headers: { "payment-signature": header } })), proof.payer);
  // strkeys are case-sensitive base32 — the address must come back verbatim.
  assert.match(proof.payer, /^G[A-Z2-7]{55}$/);
});

test("paymentPayer is null without a header, or on anything it cannot read", () => {
  const accept = makeRequirements();
  const proof = signedProof(nextTxHash(), accept);

  assert.equal(paymentPayer(makeRequest()), null, "no header means no payer");

  assert.equal(
    paymentPayer(makeRequest(ROUTE, { headers: { "payment-signature": "not a payment header" } })),
    null,
    "a header that is not base64 JSON",
  );

  const notAProof = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64");
  assert.equal(
    paymentPayer(makeRequest(ROUTE, { headers: { "payment-signature": notAProof } })),
    null,
    "decodable JSON that is not a stellar proof",
  );

  const wrongKind = Buffer.from(
    JSON.stringify({ kind: "something-else", network: accept.network, transaction: "x", payer: "y", signature: "z" }),
  ).toString("base64");
  assert.equal(
    paymentPayer(makeRequest(ROUTE, { headers: { "payment-signature": wrongKind } })),
    null,
    "a proof of the wrong kind",
  );

  const badPayer = Buffer.from(JSON.stringify({ ...proof, payer: "not-an-address" })).toString("base64");
  assert.equal(
    paymentPayer(makeRequest(ROUTE, { headers: { "payment-signature": badPayer } })),
    null,
    "a payer that is not a Stellar address",
  );
});
