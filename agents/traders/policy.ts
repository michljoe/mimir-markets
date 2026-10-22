/**
 * Pure policy predicates for the demo BYOA traders.
 *
 * Keeps decision criteria and claim filtering testable in Node without
 * needing live network connections, wallets, or databases.
 */

export interface JoinableClaimCandidate {
  id: number;
  deadline: number;
  creator: string;
  visibility: string;
}

/**
 * Filter down to claims a trader is eligible to challenge:
 * - Must not be within 5 minutes (300s) of deadline
 * - Must not be created by the trader
 * - Must have public visibility
 * - Must not already have a position by this trader
 */
export function filterJoinableClaims<T extends JoinableClaimCandidate>(
  claims: readonly T[],
  challengersById: Map<number, { address: string }[]>,
  myAddress: string,
  nowSeconds: number,
): T[] {
  const joinable: T[] = [];
  for (const claim of claims) {
    if (claim.deadline <= nowSeconds + 300) continue; // too close to settle into
    if (claim.creator === myAddress) continue; // never challenge yourself
    if (claim.visibility !== "public") continue;
    const challengers = challengersById.get(claim.id) ?? [];
    if (challengers.some((c) => c.address === myAddress)) continue; // one position each
    joinable.push(claim);
  }
  return joinable;
}

export interface SecondOpinionClaimFields {
  question?: string | null;
  creator_position?: string | null;
  counter_position?: string | null;
  resolution_url?: string | null;
  settlement_rule?: string | null;
}

export interface ShouldBuySecondOpinionOptions {
  buySecondOpinion?: boolean;
  mimirUrl?: string | null;
  dryRun?: boolean;
  claim?: SecondOpinionClaimFields | null;
}

/**
 * Pure predicate to determine if a trader should purchase an oracle second opinion over x402.
 *
 * Requirements:
 * - DRY_RUN must be false (dry runs must spend nothing, skipping paid x402 reads)
 * - BUY_SECOND_OPINION must be true
 * - MIMIR_URL must be a non-empty string
 * - claim must have a valid question and resolution_url
 */
export function shouldBuySecondOpinion(
  options: ShouldBuySecondOpinionOptions,
): boolean;
export function shouldBuySecondOpinion(
  buySecondOpinion: boolean,
  mimirUrl: string | null | undefined,
  dryRun: boolean,
  claim: SecondOpinionClaimFields | null | undefined,
): boolean;
export function shouldBuySecondOpinion(
  firstArg: ShouldBuySecondOpinionOptions | boolean,
  mimirUrl?: string | null,
  dryRun?: boolean,
  claim?: SecondOpinionClaimFields | null,
): boolean {
  if (typeof firstArg === "object" && firstArg !== null) {
    return evaluateShouldBuySecondOpinion(
      Boolean(firstArg.buySecondOpinion),
      firstArg.mimirUrl,
      Boolean(firstArg.dryRun),
      firstArg.claim,
    );
  }
  return evaluateShouldBuySecondOpinion(
    Boolean(firstArg),
    mimirUrl,
    Boolean(dryRun),
    claim,
  );
}

function evaluateShouldBuySecondOpinion(
  buySecondOpinion: boolean,
  mimirUrl: string | null | undefined,
  dryRun: boolean,
  claim: SecondOpinionClaimFields | null | undefined,
): boolean {
  if (dryRun) return false;
  if (!buySecondOpinion) return false;
  if (!mimirUrl || !mimirUrl.trim()) return false;
  if (!claim) return false;
  if (!claim.question || !claim.question.trim()) return false;
  if (!claim.resolution_url || !claim.resolution_url.trim()) return false;
  return true;
}
