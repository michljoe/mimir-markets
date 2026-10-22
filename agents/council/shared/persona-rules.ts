/*
 * Rule-based persona evaluators — no LLM call, and now no chain call either.
 *
 * The Contrarian and Whale-Watcher don't think; they just react to the
 * existing pool state. This keeps two personas free of LLM rate-limit
 * pressure and produces deterministic, easy-to-explain bets.
 *
 * Both rules return CHALLENGER (stake) or ABSTAIN. They never recommend
 * the creator side because personas can't join the creator pool.
 */

import type { PersonaSpec } from "../personas";
import type { ClaimOnChain, PersonaDecision } from "./types";

/**
 * Contrarian: stake against whichever side currently holds the larger pool.
 *
 * Since personas can only join the challenger pool, the rule reduces to:
 *   - creator pool > challenger pool → challenge (the crowd is "wrong")
 *   - creator pool ≤ challenger pool → abstain (would join the larger side)
 *
 * Adds a small fairness margin so we don't twitch on tiny imbalances.
 */
export function evaluateContrarian(
  persona: PersonaSpec,
  claim: ClaimOnChain,
): PersonaDecision {
  const stakeUsdc = persona.stakeUsdc ?? 2;
  const creator   = claim.creatorStake;
  const challenger = claim.totalChallengerStake;

  // Avoid acting when no one has staked the challenger side yet — that's the
  // market-creator's baseline pool, not "crowd sentiment".
  if (challenger === 0) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Contrarian abstains: no challenger pool yet to bet against.",
      skipReason:  "no-pool-imbalance",
    };
  }

  // Need a real imbalance — at least 20% one way. Plain numbers now: stakes are
  // display USDC, so the bigint integer division the EVM version needed (and the
  // truncation it carried) is gone.
  const total = creator + challenger;
  const creatorShare = total > 0 ? Math.round((creator * 100) / total) : 50;

  if (creatorShare >= 60) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Contrarian: creator holds ${creatorShare}% of the pool. The crowd is leaning hard one way — I take the other side.`,
    };
  }

  return {
    shouldStake: false,
    stakeUsdc:   0,
    rationale: `Contrarian abstains: pool is balanced (creator ${creatorShare}%) — nothing to react against.`,
    skipReason:  "no-pool-imbalance",
  };
}

/**
 * Whale-Watcher: copy the side staked by the single largest individual.
 *
 * - Reads the challenger roster the claim already carries.
 * - Compares the largest challenger against the creator's stake.
 * - If a challenger is the biggest, the whale is on the challenger side →
 *   the Whale-Watcher also stakes challenger.
 * - If the creator is the biggest, the whale is on creator side → abstain
 *   (the persona can't join creator).
 */
export function evaluateWhaleWatcher(
  persona: PersonaSpec,
  claim: ClaimOnChain,
): PersonaDecision {
  const stakeUsdc = persona.stakeUsdc ?? 2;

  if (claim.totalChallengerStake === 0) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Whale-Watcher waits: no challenger has staked yet, no whale to follow.",
      skipReason:  "no-whale-yet",
    };
  }

  // No longer a chain read. `get_claim` returns the challenger roster alongside
  // the claim, so the runner already holds every individual stake — the EVM version's
  // extra `getChallengerList` call, and its "failed to read, abstaining" branch,
  // were a round trip for data already in hand.
  const stakes = claim.challengerStakes;

  if (stakes.length === 0) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Whale-Watcher waits: challenger list is empty.",
      skipReason:  "no-whale-yet",
    };
  }

  const biggestChallenger = stakes.reduce((m, s) => (s > m ? s : m), 0);

  if (biggestChallenger > claim.creatorStake) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Whale-Watcher: largest individual stake is on the challenger side (${biggestChallenger.toFixed(2)} USDC vs creator's ${claim.creatorStake.toFixed(2)}). I follow the whale.`,
    };
  }

  return {
    shouldStake: false,
    stakeUsdc:   0,
    rationale: `Whale-Watcher abstains: the biggest single staker is the creator (${claim.creatorStake.toFixed(2)} USDC vs challengers). I can't join the creator side, so I sit out.`,
    skipReason:  "abstain-agrees-with-creator",
  };
}
