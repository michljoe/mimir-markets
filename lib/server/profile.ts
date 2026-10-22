/*
 * Whoever is behind an address.
 *
 * Every address on Mimir is one of three things and the page has to say which:
 * an agent's own wallet, the wallet of someone who owns agents, or a person
 * trading for themselves. They are not exclusive — an owner trades too — so this
 * resolves all of it at once rather than making the caller guess.
 *
 * Addresses used to link straight to the block explorer, which answers "what
 * transactions has this address sent" when the question on a market page is
 * "who is this, and are they any good".
 */

import "server-only";

import {
  computeAgentPerformance, windowSinceMs,
  type AgentPerformance, type AgentTradeResult, type TimeWindow,
} from "@/lib/agents/performance";
import { getAgentTradeRows, listAgentRecords } from "@/lib/db";
import { listDirectoryAgents, type DirectoryAgent } from "./agent-directory";
import { parseAddressParam } from "./api-validation";

export const PROFILE_PAGE_SIZE = 20;

export interface CursorPage<T> {
  items: T[];
  /** Cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
}

/**
 * Slice a descending list at a cursor.
 *
 * The cursor is the key of the last item on the previous page, so the
 * result is stable and shareable: the same `?cursor`= returns the same slice
 * regardless of what has been added since. A malformed cursor starts from the
 * top rather than throwing, so a stale link degrades into page 1.
 */
export function paginateByCursor<T>(
  items: T[],
  cursor: string | null | undefined,
  pageSize: number,
  getKey: (item: T) => number,
): CursorPage<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const parsed = cursor == null || cursor === "" ? NaN : Number(cursor);
  const after = Number.isFinite(parsed) ? parsed : null;
  const start = after === null ? 0 : items.findIndex((item) => getKey(item) < after);
  const from = start < 0 ? items.length : start;
  const slice = items.slice(from, from + size);
  const hasMore = from + size < items.length;
  return {
    items: slice,
    nextCursor: hasMore && slice.length > 0 ? String(getKey(slice[slice.length - 1])) : null,
  };
}

export interface OwnedAgentView extends DirectoryAgent {
  performance: AgentPerformance;
}

export interface ProfileView {
  /** A stellar strkey — `G …` account or `C…` contract — exactly as validated. */
  address: string;
  /** Set when this address IS an agent rather than a person. */
  agent: DirectoryAgent | null;
  /** Agents registered to this address as owner. */
  ownedAgents: OwnedAgentView[];
  /** This address's own trading, whether it is a person or an agent. */
  performance: AgentPerformance;
  /** This page's slice of the address's trades, newest claim first. */
  results: AgentTradeResult[];
  /** Cursor for the next page of results, or null on the last page. */
  nextCursor: string | null;
  /** Everything the owned agents realised, summed. */
  agentsRealisedPnlAtomic: bigint;
  agentsSettled: number;
}

export async function buildProfile(
  rawAddress: string,
  window: TimeWindow = "all",
  nowMs = Date.now(),
  cursor: string | null = null,
): Promise<ProfileView | null> {
  // A Stellar strkey, used verbatim from here on. The `/^0x…{40}$/` guard this
  // replaced rejected every real address, so every profile page returned null;
  // the `toLowerCase()` next to it would then have matched no stored row anyway.
  const address = parseAddressParam(rawAddress);
  if (!address) return null;
  const sinceMs = windowSinceMs(window, nowMs);

  const [directory, records, ownRows] = await Promise.all([
    listDirectoryAgents().catch(() => []),
    listAgentRecords(200).catch(() => []),
    getAgentTradeRows(address).catch(() => []),
  ]);

  const agent = directory.find((candidate) => candidate.address === address) ?? null;

  // An owner's agents operate from their own wallets, so their P&L is looked up
  // per agent rather than rolled into the owner's own trading.
  const owned = directory.filter((candidate) => {
    const record = records.find((r) => r.agentId === candidate.id);
    return record?.ownerWallet === address;
  });
  const ownedRows = await Promise.all(
    owned.map((candidate) => getAgentTradeRows(candidate.address).catch(() => [])),
  );

  let agentsRealisedPnlAtomic = 0n;
  let agentsSettled = 0;
  const ownedAgents: OwnedAgentView[] = owned.map((candidate, index) => {
    const { performance } = computeAgentPerformance(ownedRows[index], { sinceMs });
    agentsRealisedPnlAtomic += performance.realisedPnlAtomic;
    agentsSettled += performance.settled;
    return { ...candidate, performance };
  });

  const { performance, results } = computeAgentPerformance(ownRows, { sinceMs });
  // Newest claim first, then slice at the cursor so the profile page only pays for
  // the markets it actually renders.
  const sorted = results.sort((a, b) => b.claimId - a.claimId);
  const page = paginateByCursor(sorted, cursor, PROFILE_PAGE_SIZE, (result) => result.claimId);

  return {
    address,
    agent,
    ownedAgents,
    performance,
    results: page.items,
    nextCursor: page.nextCursor,
    agentsRealisedPnlAtomic: agentsRealisedPnlAtomic,
    agentsSettled: agentsSettled,
  };
}

/** Owner wallet for an agent id, for the "created by" line on an agent page. */
export async function findAgentOwner(agentId: string): Promise<string | null> {
  const records = await listAgentRecords(200).catch(() => []);
  return records.find((record) => record.agentId === agentId)?.ownerWallet ?? null;
}
