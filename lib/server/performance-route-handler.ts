/**
 * GET /api/performance/[address] — portfolio performance for one wallet.
 *
 * The handler lives here rather than in the route so the rate limit, the cache
 * and the error envelope can be exercised in a node test with a stubbed
 * calculator and no database (the pattern claim-moderation-route-handler set).
 *
 * Two costs are being managed. Every request used to fold the read index into a
 * P&L curve from scratch, and the profile and dashboard pages poll it — so the
 * same address was recomputed many times a minute for an identical answer. The
 * computation is memoized per address, and the response is cacheable at the CDN
 * for a fraction of the sync interval. Neither changes the maths.
 */

import { NextResponse } from "next/server";

import { computeAgentPerformance, cumulativePnlPoints } from "@/lib/agents/performance";
import { apiError } from "@/lib/api/errors";
import { authorizeRequest } from "@/lib/api/policy";
import { getAgentTradeRows, getSyncMeta } from "@/lib/db";
import type { PortfolioPerformanceResponse } from "@/lib/portfolio-performance";
import { parseAddressParam } from "@/lib/server/api-validation";
import { cachedFor } from "@/lib/server/ttl-cache";
import { buildVSCacheFreshness } from "@/lib/vs-freshness";

export const PERFORMANCE_ROUTE = "/api/performance/[address]";

/** How long one computation is reused for repeat reads of the same address. */
export const PERFORMANCE_CACHE_TTL_MS = 30_000;

/**
 * The CDN may serve a copy for 30s and hand back to the origin for another 120s
 * while it revalidates, so a deploy is not blocked behind a cold cache. Both
 * numbers sit well under the sync interval that drives the freshness block in
 * the body, so a cached response never contradicts the staleness it reports.
 */
export const PERFORMANCE_CACHE_CONTROL = "s-maxage=30, stale-while-revalidate=120";

const DEFAULT_SYNC_INTERVAL_MS = 300_000;
const SETTLEMENT_LAST_SYNC_META_KEY = "settlement_last_sync_at";

function performanceFreshnessWindowMs(): number {
  const configured = Number(process.env.SYNC_POLL_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SYNC_INTERVAL_MS;
}

/** What the endpoint costs: two read-index queries plus the P&L fold. */
export type PerformanceCalculator = (
  address: string,
) => Promise<PortfolioPerformanceResponse>;

export const readIndexPerformance: PerformanceCalculator = async (address) => {
  const [rows, lastSettlementSync] = await Promise.all([
    getAgentTradeRows(address),
    getSyncMeta(SETTLEMENT_LAST_SYNC_META_KEY),
  ]);
  const { performance, results } = computeAgentPerformance(rows);
  const updatedAtMs = Number(lastSettlementSync ?? "0");

  return {
    points: cumulativePnlPoints(results),
    settled: performance.settled,
    cache: buildVSCacheFreshness({
      updatedAtMs:
        Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : null,
      freshnessWindowMs: performanceFreshnessWindowMs(),
      source: "index",
    }),
  };
};

/**
 * Memoize one computation per address for {@link PERFORMANCE_CACHE_TTL_MS}.
 *
 * Exported as a factory so a test can wrap a stubbed calculator exactly the way
 * production wraps the read-index one, and prove that a repeat request for the
 * same address does not recompute.
 */
export function createPerformanceSnapshot(
  calculator: PerformanceCalculator = readIndexPerformance,
  ttlMs: number = PERFORMANCE_CACHE_TTL_MS,
): PerformanceCalculator {
  return cachedFor(calculator, ttlMs);
}

/** One cached loader per warm instance, which is what cachedFor is for. */
export const performanceSnapshot = createPerformanceSnapshot();

export interface PerformanceGetOptions {
  /** Defaults to the instance-cached loader; tests pass a stubbed one. */
  snapshot?: PerformanceCalculator;
  ip?: string;
  now?: number;
}

export async function handlePerformanceGet(
  rawAddress: string | undefined,
  {
    snapshot = performanceSnapshot,
    ip,
    now = Date.now(),
  }: PerformanceGetOptions = {},
): Promise<NextResponse> {
  const address = parseAddressParam(rawAddress);
  if (!address) {
    const err = apiError("invalid_request", "Invalid address", { field: "address" });
    return NextResponse.json(err.body, {
      status: err.status,
      headers: { ...err.headers, "Cache-Control": "no-store" },
    });
  }

  // public_read: IP and route buckets only, because an anonymous caller has no
  // wallet to bucket by. Refusing here also keeps a flood from reaching the fold.
  const gate = await authorizeRequest(
    "public_read",
    { route: PERFORMANCE_ROUTE, ip },
    undefined,
    now,
  );
  if (!gate.allowed && gate.error) {
    return NextResponse.json(gate.error.body, {
      status: gate.error.status,
      headers: { ...gate.error.headers, "Cache-Control": "no-store" },
    });
  }

  try {
    const body = await snapshot(address);
    return NextResponse.json(body, {
      headers: { "Cache-Control": PERFORMANCE_CACHE_CONTROL },
    });
  } catch {
    const err = apiError("upstream_unavailable", "Unable to load portfolio performance");
    return NextResponse.json(err.body, {
      status: err.status,
      headers: { ...err.headers, "Cache-Control": "no-store" },
    });
  }
}
