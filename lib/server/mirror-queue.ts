/*
 * What a basket subscriber has not mirrored yet.
 *
 * Following a basket records an intent; it cannot move money on its own. Soroban
 * has no `msg.sender` for a top-level call, so the staking account is an explicit
 * argument that must itself authorise -- `challenge_claim(challenger, …#` cannot
 * execute without that account's signature, and Mimir holds no key for the
 * subscriber. Delegated signing would need an owner-granted USDC allowance
 * (`lib/agents/spend-permissions.ts`), which a plain basket follower has not given.
 *
 * So the honest middle is this: compute what the subscriber WOULD have mirrored,
 * show it, and let them sign it themselves in one click. No custody, no waiting on
 * infrastructure that is not configured, and the queue is exactly the input the
 * delegated executor will consume once it exists.
 *
 * Positions already taken are excluded, so a mirror is never offered twice and
 * re-following does not duplicate anything.
 */

import "server-only";

import { getChallengersByClaimId, getClaimsByFilter, listBasketSubscriptions } from "@/lib/db";
import { allBasketDefinitions } from "./basket-directory";
import { listDirectoryAgents } from "./agent-directory";
import { parseAddressParam } from "./api-validation";

export interface PendingMirror {
  basketId: string;
  basketName: string;
  claimId: number;
  question: string;
  /** The member whose position is being copied. */
  agentId: string;
  agentName: string;
  /** What that member staked, display USDC. */
  memberStakeUsdc: number;
  /** What the subscriber would stake: their per-market cap scaled by weight. */
  mirrorUsdc: number;
  weightBps: number;
  deadline: number;
}

/** The data sources the queue is built from, injectable for testing. */
export interface MirrorQueueDependencies {
  listSubscriptions: (wallet: string) => Promise<string[]>;
  listDefinitions: () => Promise<Array<{ id: string; name: string; members: Array<{ agentId: string; weightBps: number }> }>>;
  listAgents: () => Promise<Array<{ id: string; displayName: string; address: string }>>;
  listOpenClaims: () => Promise<Array<{ id: number; question?: string | null; deadline: number; creator?: string | null }>>;
  listChallengers: (claimId: number) => Promise<Array<{ address: string; stake: number }>>;
}

const defaultDependencies: MirrorQueueDependencies = {
  listSubscriptions: (wallet) => listBasketSubscriptions(wallet),
  listDefinitions: () => allBasketDefinitions(),
  listAgents: () => listDirectoryAgents(),
  listOpenClaims: () =>
    getClaimsByFilter({ states: ["open", "active"], orderBy: "deadline_asc", limit: 50 }),
  listChallengers: (claimId) => getChallengersByClaimId(claimId),
};

/**
 * Mirrors still open to a subscriber.
 *
 * Weighted, not flat: a member at 10% of a basket should pull 10% of the
 * subscriber's per-market budget, or following a basket would just be following
 * whichever member happened to act first.
 */
export async function pendingMirrorsFor(
  subscriber: string,
  perMarketUsdc: Record<string, number> = {},
  dependencies: MirrorQueueDependencies = defaultDependencies,
): Promise<PendingMirror[]> {
  // Strkey check, and the address is then used verbatim throughout. The EVM regex
  // this replaced rejected every Stellar address, so the mirror queue was empty
  // for every real user; the `toLowerCase()` beside it would then have failed to
  // match any stored strkey even if the guard had let one through.
  const wallet = parseAddressParam(subscriber);
  if (!wallet) return [];

  const subscribed = await dependencies.listSubscriptions(wallet).catch(() => []);
  if (subscribed.length === 0) return [];

  const [definitions, directory, openClaims] = await Promise.all([
    dependencies.listDefinitions().catch(() => []),
    dependencies.listAgents().catch(() => []),
    dependencies.listOpenClaims().catch(() => []),
  ]);
  const agentById = new Map(directory.map((agent) => [agent.id, agent]));
  const nowSeconds = Math.floor(Date.now() / 1000);

  const pending: PendingMirror[] = [];

  for (const basketId of subscribed) {
    const definition = definitions.find((candidate) => candidate.id === basketId);
    if (!definition) continue;
    const budget = perMarketUsdc[basketId] ?? 2;

    for (const claim of openClaims) {
      // No point offering a mirror that cannot be staked before it settles.
      if (claim.deadline <= nowSeconds + 300) continue;
      if (claim.creator === wallet) continue;

      const challengers = await dependencies.listChallengers(claim.id).catch(() => []);
      const taken = new Set(challengers.map((c) => c.address));
      if (taken.has(wallet)) continue; // already mirrored, or acted independently

      for (const member of definition.members) {
        const agent = agentById.get(member.agentId);
        if (!agent) continue;
        const position = challengers.find((c) => c.address === agent.address);
        if (!position) continue;

        const mirrorUsdc = Math.round((budget * member.weightBps / 10_000) * 100) / 100;
        // Below a cent there is nothing to stake; the contract's minimum would
        // reject it anyway and the row would only be noise.
        if (mirrorUsdc <= 0) continue;

        pending.push({
          basketId, basketName: definition.name,
          claimId: claim.id, question: claim.question ?? `Claim #${claim.id}`,
          agentId: agent.id, agentName: agent.displayName,
          memberStakeUsdc: position.stake, mirrorUsdc: mirrorUsdc,
          weightBps: member.weightBps, deadline: claim.deadline,
        });
        break; // one mirror per claim: the basket takes a side, not several
      }
    }
  }

  return pending.sort((a, b) => a.deadline - b.deadline);
}
