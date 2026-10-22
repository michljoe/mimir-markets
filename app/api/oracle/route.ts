/*
 * Mimir Oracle-as-a-Service — sell the oracle's verdict per call.
 *
 * POST /api/oracle   ($0.005 in USDC / verdict, over x402)
 *   body: { question, sideA, sideB, evidenceUrl, settlementRule? }
 *
 * This monetizes Mimir's core competency — reading evidence and judging an
 * outcome — as a standalone, pay-per-call service. Any agent or app signs a
 * small USDC authorization and gets back a verdict with confidence + an
 * evidence hash they can verify themselves.
 *
 * Unpaid → PAYMENT-REQUIRED 402. Signed retry → the verdict.
 */

import {
  EVIDENCE_COMMITMENT_VERSION,
  evidenceCommitmentHash,
  type CommittedFetcherKind,
} from "@/lib/evidence-commitment";
import { NextResponse, type NextRequest } from "next/server";
import { paidRoute } from "@/lib/x402/server";
import { PRICES } from "@/lib/x402/config";
import { callLLM } from "@/lib/llm";
import { fetchEvidence } from "@/lib/server/evidence-fetcher";
import { runOracleService } from "@/lib/oracle/service-prompt";

const MAX_EVIDENCE_CHARS = 8_000;

interface VerdictRequest {
  question?: string;
  sideA?: string;
  sideB?: string;
  evidenceUrl?: string;
  settlementRule?: string;
}

async function handler(req: NextRequest): Promise<NextResponse> {
  let body: VerdictRequest;
  try {
    body = (await req.json()) as VerdictRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const question = body.question?.trim();
  const sideA = body.sideA?.trim();
  const sideB = body.sideB?.trim();
  const evidenceUrl = body.evidenceUrl?.trim();
  if (!question || !sideA || !sideB || !evidenceUrl) {
    return NextResponse.json(
      { error: "question, sideA, sideB, evidenceUrl are required" },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//.test(evidenceUrl)) {
    return NextResponse.json({ error: "evidenceUrl must be http(s)" }, { status: 400 });
  }

  // Fetch evidence + judge. Same canonical evidence-hash discipline as on-chain
  // settle, so a caller can verify the digest the same way.
  let evidenceText = "(no evidence)";
  let fetcher: CommittedFetcherKind = "none";
  let sourceUrl: string | undefined;
  let fetchedAt: number | undefined;
  try {
    const snap = await fetchEvidence(evidenceUrl, { maxChars: MAX_EVIDENCE_CHARS, userAgent: "Mimir-OracleAPI/1.0" });
    evidenceText = snap.text;
    fetcher = snap.fetcher;
    sourceUrl = snap.sourceUrl;
    fetchedAt = snap.fetchedAt;
  } catch {
    /* fall through with placeholder; LLM will likely return UNRESOLVABLE */
  }

  const { verdict, confidence, explanation } = await runOracleService(
    {
      question,
      sideA,
      sideB,
      settlementRule: body.settlementRule?.trim(),
      evidenceUrl,
      evidenceText,
    },
    { complete: (prompt) => callLLM(prompt, { maxTokens: 1024, jsonOnly: true }) },
  );

  // Canonical, versioned commitment over the evidence bytes (length-framed, so an
  // attacker-controlled page cannot forge a boundary). No prompt, wallet or
  // analytics field enters the digest. A malformed snapshot throws and surfaces
  // as a 500 rather than returning an unverifiable hash.
  const evidenceHash = evidenceCommitmentHash({
    evidence:  evidenceText,
    fetcher,
    sourceUrl,
    fetchedAt,
    now:       Date.now(),
  });

  return NextResponse.json({
    verdict,
    confidence,
    explanation,
    evidenceHash,
    evidenceCommitmentVersion: EVIDENCE_COMMITMENT_VERSION,
    evidenceFetcher: fetcher,
    price: PRICES.oracle,
  });
}

export const POST = paidRoute("oracle", handler);
