/**
 * Council pass — one payment buys a window of free council reads.
 *
 * POST /api/council/subscribe   ($0.01 USDC → platform seller)
 *   → { pass, expiresAt, plan }
 *
 * Pass the returned token to /api/council/reasoning?...&pass=<pass> and reads are
 * free until it expires (default 10 min). This is the bundled-access tier on top
 * of the per-read payment; it is deliberately NOT a recurring subscription —
 * per-request x402 and real recurring billing are separate payment products.
 * Unpaid → PAYMENT-REQUIRED 402.
 */

import { NextResponse, type NextRequest } from "next/server";
import { paidRoute, paymentPayer } from "@/lib/x402/server";
import { PRICES } from "@/lib/x402/config";
import { issuePass } from "@/lib/server/paid-pass";
import { resolveCouncilPassTtlMs } from "@/lib/council/pass-ttl";

const PLAN = "council";

async function handler(req: NextRequest): Promise<NextResponse> {
  // Bind the pass to whoever signed the payment the paywall just verified.
  const payer = paymentPayer(req);
  if (!payer) {
    return NextResponse.json({ error: "could not read payer from payment" }, { status: 400 });
  }
  // Resolve the lifetime per request through the shared policy: a malformed
  // COUNCIL_PASS_TTL_MS ("10m", "", "-5") falls back to the 10-minute default
  // instead of minting a pass with a NaN/negative lifetime, and the TTL we
  // report is exactly the one the pass was issued with.
  const ttlMs = resolveCouncilPassTtlMs(process.env.COUNCIL_PASS_TTL_MS);
  const { pass, expiresAt } = issuePass(payer, PLAN, ttlMs);
  return NextResponse.json({
    plan: PLAN,
    payer,
    pass,
    expiresAt,
    ttlMs,
    price: PRICES.councilSubscribe,
  });
}

export const POST = paidRoute("councilSubscribe", handler);
