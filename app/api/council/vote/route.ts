/**
 * Council vote, pay-per-call — binds the council to settlement (RFB #6 + the
 * Lepton multi-agent-consensus story).
 *
 * GET /api/council/vote?claimId=12&persona=optimist   ($0.001 USDC / vote)
 *
 * The oracle BUYS each persona's verdict during settlement: it signs a small
 * USDC authorization (paid into the persona's OWN wallet) and gets back a
 * structured vote. The oracle tallies these into the on-chain verdict — so every
 * persona is a paid juror, not just decoration. Unpaid → PAYMENT-REQUIRED 402.
 *
 * Evidence is fetched server-side (free fetch only; a 402 source makes the
 * persona abstain rather than nest a payment).
 */

import { NextResponse, type NextRequest } from "next/server";
import { paidRoute, queryParam } from "@/lib/x402/server";
import { tracedRoute } from "@/lib/ops/trace-http";
import type { HTTPRequestContext } from "@x402/core/http";
import { PRICES } from "@/lib/x402/config";
import { getPersonaBySlug } from "@/agents/council/personas";
import { councilPayoutRefusal, resolveCouncilPayout } from "@/lib/ops/council-payouts";
import { readClaimRaw } from "@/lib/contract";
import { toClaimOnChain } from "@/agents/council/shared/types";
import { evaluateClaimAsPersona } from "@/agents/council/shared/persona-llm";
import { fetchEvidence } from "@/lib/server/evidence-fetcher";
import { parseHistory } from "@/lib/council/history";
import type { ClaimOnChain } from "@/agents/council/shared/types";

const MAX_EVIDENCE_CHARS = 8_000;

/** Recipient of this vote's fee — the juror itself, not the platform. */
function personaAddress(ctx: HTTPRequestContext): string {
  const slug = queryParam(ctx, "persona").toLowerCase().trim();
  const payout = resolveCouncilPayout(slug);
  if (!payout.ok) throw new Error(payout.reason);
  return payout.address;
}

/**
 * Refuse to quote a 402 for a persona whose payout address failed validation.
 * An unknown persona stays the handler's 400 — there is no address to validate.
 */
function personaQuotable(req: NextRequest): NextResponse | null {
  const slug = (req.nextUrl.searchParams.get("persona") ?? "").toLowerCase().trim();
  if (!getPersonaBySlug(slug)) return null;
  const refusal = councilPayoutRefusal(slug);
  if (!refusal) return null;
  return NextResponse.json(refusal.body, {
    status: refusal.status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const claimId = Number(searchParams.get("claimId"));
  const slug = (searchParams.get("persona") ?? "").toLowerCase().trim();
  const history = parseHistory(searchParams.get("history"));

  // A handler error means no settlement, so an unservicable request costs nothing.
  const persona = getPersonaBySlug(slug);
  if (!persona) return NextResponse.json({ error: `unknown persona '${slug}'` }, { status: 400 });
  if (!persona.promptBias) {
    // Rule-based personas (contrarian, whale-watcher) trade on pool dynamics,
    // not on evidence — they can't judge what actually happened.
    return NextResponse.json({ error: `persona '${slug}' does not vote on settlement` }, { status: 422 });
  }
  if (!Number.isInteger(claimId) || claimId < 1) {
    return NextResponse.json({ error: "claimId must be a positive integer" }, { status: 400 });
  }
  const payout = resolveCouncilPayout(slug);
  if (!payout.ok) {
    return NextResponse.json(
      {
        error: payout.reason,
        code: "payment_recipient_unavailable",
        variable: payout.variable,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const payTo = payout.address;

  // Read the claim from chain. One `get_claim` through the generated bindings,
  // which returns a NAMED struct — the positional-tuple decoder this used to go
  // through had no Soroban equivalent and is gone.
  let claim: ClaimOnChain;
  try {
    const decoded = await readClaimRaw(claimId);
    if (!decoded) {
      return NextResponse.json({ error: `claim ${claimId} not found` }, { status: 404 });
    }
    claim = toClaimOnChain(decoded);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "read failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Specialists only vote within their category — otherwise abstain.
  if (
    persona.categoryFilter &&
    !persona.categoryFilter.some((c) => c.toLowerCase() === claim.category.toLowerCase())
  ) {
    return NextResponse.json({
      persona: { slug, name: persona.displayName, emoji: persona.emoji },
      claimId,
      verdict: "UNRESOLVABLE",
      confidence: 0,
      explanation: `[${persona.displayName} abstains — out of category]`,
      paidTo: payTo,
      price: PRICES.councilVote,
    });
  }

  // Fetch evidence (free fetch; paywalled sources → abstain, no nested payment).
  let evidenceText = "(No resolution URL provided)";
  if (claim.resolutionUrl?.startsWith("http")) {
    try {
      const snap = await fetchEvidence(claim.resolutionUrl, { maxChars: MAX_EVIDENCE_CHARS, userAgent: "Mimir-Council/1.0" });
      evidenceText = snap.text;
    } catch {
      evidenceText = "(Failed to fetch evidence)";
    }
  }

  const verdict = await evaluateClaimAsPersona(persona, claim, evidenceText, history);

  return NextResponse.json({
    persona: { slug, name: persona.displayName, emoji: persona.emoji },
    claimId,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    explanation: verdict.explanation,
    paidTo: payTo,
    price: PRICES.councilVote,
  });
}

// Dynamic payTo: each juror is paid into its own wallet.
//
// `tracedRoute` is the outermost wrapper, so a 402 that never reached the handler
// is still traced: the oracle's buy-a-vote cycle and the web request it made share
// one id, and the response carries it. See docs/TRACE_CORRELATION.md.
export const GET = tracedRoute(
  "api.council.vote",
  paidRoute("councilVote", handler, {
    payTo: personaAddress,
    beforeQuote: personaQuotable,
  }),
);
