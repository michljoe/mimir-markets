/**
 * Dedupe helpers for market-creator candidates.
 *
 * Two candidates are considered duplicates when they share the same
 * (question, resolutionUrl, deadline) signature. The signature is normalised
 * so that case, punctuation and whitespace differences don't produce duplicates
 * on-chain.
 */

export interface CandidateLike {
  question?: string;
  resolutionUrl?: string;
  deadline?: string;
  // Optional canonical fields that may be present on candidates.
  id?: string;
  title?: string;
  [key: string]: unknown;
}

function normaliseQuestion(question: string | undefined): string {
  if (!question) return "";
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseUrl(url: string | undefined): string {
  if (!url) return "";
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function normaliseDeadline(deadline: string | undefined): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return deadline.trim().toLowerCase();
  return new Date(ms).toISOString();
}

/**
 * Build a stable signature for a candidate. Used to detect duplicates
 * across the same run and against already-created markets.
 */
export function buildCandidateSignature(candidate: CandidateLike): string {
  const question = normaliseQuestion(candidate.question ?? candidate.title);
  const url = normaliseUrl(candidate.resolutionUrl);
  const deadline = normaliseDeadline(candidate.deadline);
  return `${question}|${url}|${deadline}`;
}

/**
 * Filter duplicate candidates while preserving input order.
 *
 * The first occurrence of a signature wins; subsequent ones are dropped.
 * An optional `seen` set can be passed in to also dedupe against candidates
 * that already exist on-chain or in a previous batch.
 */
export function filterDuplicateCandidates<T extends CandidateLike>(
  candidates: readonly T[],
  seen: Set<string> = new Set(),
): T[] {
  const out: T[] = [];
  for (const candidate of candidates) {
    const sig = buildCandidateSignature(candidate);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(candidate);
  }
  return out;
}
