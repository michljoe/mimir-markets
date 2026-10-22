import assert from "node:assert/strict";
import test from "node:test";

import { StrKey } from "@stellar/stellar-sdk";

import { resetRateLimits } from "../../lib/api/rate-limit";
import {
  PERFORMANCE_CACHE_CONTROL,
  PERFORMANCE_CACHE_TTL_MS,
  createPerformanceSnapshot,
  handlePerformanceGet,
  performanceSnapshot,
  readIndexPerformance,
  type PerformanceCalculator,
} from "../../lib/server/performance-route-handler";
import type { PortfolioPerformanceResponse } from "../../lib/portfolio-performance";

function address(fill: number): string {
  return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
}

const ALICE = address(1);
const BOB = address(2);

/** A body shaped like the real response, so the guard in lib/portfolio-performance holds. */
function snapshot(settled: number): PortfolioPerformanceResponse {
  return {
    points: [{ timestamp: 1_800_000_000_000, value: settled }],
    settled,
    cache: {
      source: "index",
      status: "live",
      lastUpdatedAt: "2026-10-01T00:00:00.000Z",
      ageMs: 1_000,
      freshnessWindowMs: 300_000,
    },
  };
}

function countingCalculator(): { calculator: PerformanceCalculator; calls: string[] } {
  const calls: string[] = [];
  const calculator: PerformanceCalculator = async (usedAddress) => {
    calls.push(usedAddress);
    return snapshot(calls.length);
  };
  return { calculator, calls };
}

/** Every test gets a clean rate-limit clock: these buckets are module-global. */
function freshIp(label: string): string {
  resetRateLimits();
  return label;
}

function controlledClock(start: number) {
  const original = Date.now;
  Date.now = () => start;
  return {
    advance(ms: number) {
      start += ms;
    },
    restore() {
      Date.now = original;
    },
  };
}

// ── Caching ───────────────────────────────────────────────────────────────────

test("a repeat read for the same address is served without recomputing", async () => {
  const { calculator, calls } = countingCalculator();
  const snapshotFor = createPerformanceSnapshot(calculator);
  const ip = freshIp("198.51.100.1");

  const first = await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip, now: 1_000_000 });
  const second = await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip, now: 1_010_000 });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(calls, [ALICE], "the calculator must run exactly once inside the TTL");
  assert.deepEqual(await second.json(), await first.json(), "a cache hit is the same answer");
  assert.equal(first.headers.get("cache-control"), PERFORMANCE_CACHE_CONTROL);
  assert.equal(second.headers.get("cache-control"), PERFORMANCE_CACHE_CONTROL);
});

test("a different address is a different cache key", async () => {
  const { calculator, calls } = countingCalculator();
  const snapshotFor = createPerformanceSnapshot(calculator);
  const ip = freshIp("198.51.100.2");

  await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip, now: 1_000_000 });
  await handlePerformanceGet(BOB, { snapshot: snapshotFor, ip, now: 1_000_000 });
  await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip, now: 1_000_000 });

  assert.deepEqual(calls, [ALICE, BOB], "one computation per address, keyed by address");
});

test("the TTL actually expires instead of pinning the first answer forever", async () => {
  const clock = controlledClock(1_000_000);
  const { calculator, calls } = countingCalculator();
  const snapshotFor = createPerformanceSnapshot(calculator, PERFORMANCE_CACHE_TTL_MS);
  const ip = freshIp("198.51.100.3");
  try {
    await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip });
    await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip });
    assert.equal(calls.length, 1);

    clock.advance(PERFORMANCE_CACHE_TTL_MS);
    await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip });
    assert.equal(calls.length, 2, "an expired entry must be recomputed");
  } finally {
    clock.restore();
  }
});

test("the production loader is the cached one, not the raw calculator", () => {
  // Guards the wiring the handler exports: a future refactor that hands the route
  // readIndexPerformance directly would silently drop the cache this issue adds.
  assert.notEqual(performanceSnapshot, readIndexPerformance);
});

// ── Rate limit ────────────────────────────────────────────────────────────────

test("a caller over the limit gets the 429 envelope and computes nothing", async () => {
  const { calculator, calls } = countingCalculator();
  const snapshotFor = createPerformanceSnapshot(calculator);
  const ip = freshIp("198.51.100.4");
  const now = 5_000_000;

  let last: Awaited<ReturnType<typeof handlePerformanceGet>> | undefined;
  for (let i = 0; i < 400; i += 1) {
    last = await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip, now });
    if (last.status === 429) break;
  }

  assert.ok(last, "the loop must reach a refusal");
  assert.equal(last.status, 429);
  const body = await last.json();
  assert.equal(body.error.code, "rate_limited");
  assert.equal(body.error.retryable, true);
  assert.equal(last.headers.get("retry-after"), "60");
  assert.equal(last.headers.get("cache-control"), "no-store", "a refusal must not be cacheable");

  // The requests that were allowed still folded the address once: the rate limit
  // must not turn into a recompute storm, which is the point of the cache.
  assert.equal(calls.length, 1);
});

// ── Errors stay uncached ──────────────────────────────────────────────────────

test("an invalid address is a 400 that never reaches the calculator", async () => {
  const { calculator, calls } = countingCalculator();
  const ip = freshIp("198.51.100.5");

  const response = await handlePerformanceGet("not-a-strkey", {
    snapshot: createPerformanceSnapshot(calculator),
    ip,
    now: 1_000_000,
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
  assert.equal(body.error.field, "address");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, []);
});

test("a failing calculation is a 503, not a stack trace at the caller", async () => {
  resetRateLimits();
  const failing: PerformanceCalculator = async () => {
    throw new Error("read index unreachable");
  };
  const snapshotFor = createPerformanceSnapshot(failing);

  const response = await handlePerformanceGet(ALICE, { snapshot: snapshotFor, ip: "198.51.100.6", now: 1_000_000 });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "upstream_unavailable");
  assert.equal(body.error.retryable, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
