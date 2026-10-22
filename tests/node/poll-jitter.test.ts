import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLL_JITTER_RATIO,
  defaultPollJitterMs,
  jitteredIntervalMs,
  resolvePollJitterMs,
} from "../../lib/ops/poll-jitter";
import { runWorkerLoop } from "../../lib/ops/heartbeat";

/** Deterministic PRNG (mulberry32) so a "random" assertion is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ── The computation ───────────────────────────────────────────────────────────

test("the default spread is 10% of the interval", () => {
  assert.equal(DEFAULT_POLL_JITTER_RATIO, 0.1);
  assert.equal(defaultPollJitterMs(60_000), 6_000);
  assert.equal(defaultPollJitterMs(180_000), 18_000);
  assert.equal(defaultPollJitterMs(0), 0);
  assert.equal(defaultPollJitterMs(Number.NaN), 0);
});

test("jitter 0 restores exact fixed scheduling without touching the RNG", () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0.5;
  };
  for (const intervalMs of [1_000, 60_000, 3_600_000]) {
    assert.equal(jitteredIntervalMs({ intervalMs, jitterMs: 0, random }), intervalMs);
  }
  assert.equal(calls, 0);
});

test("a seeded run stays inside interval ± jitter", () => {
  const rng = seededRandom(7);
  for (let i = 0; i < 1_000; i += 1) {
    const delay = jitteredIntervalMs({ intervalMs: 60_000, jitterMs: 6_000, random: rng });
    assert.ok(delay >= 54_000 && delay <= 66_000, `delay ${delay} outside bounds`);
    assert.equal(Number.isInteger(delay), true);
  }
});

test("the same seed produces the same schedule", () => {
  const draw = (seed: number) => {
    const rng = seededRandom(seed);
    return Array.from({ length: 5 }, () =>
      jitteredIntervalMs({ intervalMs: 10_000, jitterMs: 1_000, random: rng }),
    );
  };
  assert.deepEqual(draw(42), draw(42));
  assert.notDeepEqual(draw(42), draw(43));
});

test("both edges of the range are reachable", () => {
  const intervalMs = 10_000;
  const jitterMs = 1_000;
  // random() = 0 → -jitter; random() just below 1 → +jitter (after rounding).
  assert.equal(jitteredIntervalMs({ intervalMs, jitterMs, random: () => 0 }), 9_000);
  assert.equal(
    jitteredIntervalMs({ intervalMs, jitterMs, random: () => 0.999_999 }),
    11_000,
  );
});

test("the delay never goes negative when jitter exceeds the interval", () => {
  assert.equal(jitteredIntervalMs({ intervalMs: 1_000, jitterMs: 5_000, random: () => 0 }), 0);
});

test("invalid intervals are a zero wait rather than NaN", () => {
  for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(jitteredIntervalMs({ intervalMs, jitterMs: 100 }), 0);
  }
});

// ── Env parsing ───────────────────────────────────────────────────────────────

test("unset and blank values use the 10% default", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.equal(resolvePollJitterMs(60_000, raw), 6_000);
  }
});

test("an explicit value is used, including zero", () => {
  assert.equal(resolvePollJitterMs(60_000, "1500"), 1_500);
  assert.equal(resolvePollJitterMs(60_000, "0"), 0);
  assert.equal(resolvePollJitterMs(60_000, " 250 "), 250);
});

test("a malformed value falls back to the default, not to no jitter", () => {
  // A typo must not silently re-synchronise the fleet: that is the failure this
  // feature exists to prevent.
  for (const raw of ["abc", "-1", "Infinity", "10ms", "NaN"]) {
    assert.equal(resolvePollJitterMs(60_000, raw), 6_000, raw);
  }
});

test("jitter is clamped to one interval", () => {
  assert.equal(resolvePollJitterMs(10_000, "999999"), 10_000);
});

// ── Applied by the shared scheduler ───────────────────────────────────────────

test("runWorkerLoop sleeps the jittered interval between cycles", async () => {
  const delays: number[] = [];
  const handlers = new Map<string, (signal: NodeJS.Signals) => void>();
  let cycles = 0;

  const fakeSetTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
    delays.push(Number(ms));
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  const fakeProcess = {
    on: (signal: string, handler: (value: NodeJS.Signals) => void) =>
      handlers.set(signal, handler),
    off: () => undefined,
    exit: () => undefined,
  } as unknown as Pick<NodeJS.Process, "on" | "off" | "exit">;

  await runWorkerLoop({
    worker: "oracle",
    intervalMs: 1_000,
    jitterMs: 100,
    random: seededRandom(42),
    cycle: async () => {
      cycles += 1;
      if (cycles === 3) handlers.get("SIGTERM")?.("SIGTERM");
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    process: fakeProcess,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    exit: () => undefined,
  });

  assert.equal(cycles, 3);
  // Two poll waits; the third timer is the shutdown hard timeout.
  assert.equal(delays.length, 3);
  assert.equal(delays[2], 30_000);

  const expectedRng = seededRandom(42);
  const expected = [
    jitteredIntervalMs({ intervalMs: 1_000, jitterMs: 100, random: expectedRng }),
    jitteredIntervalMs({ intervalMs: 1_000, jitterMs: 100, random: expectedRng }),
  ];
  assert.deepEqual(delays.slice(0, 2), expected);
  for (const delay of delays.slice(0, 2)) {
    assert.ok(delay >= 900 && delay <= 1_100, `delay ${delay} outside bounds`);
  }
});

test("runWorkerLoop with jitter 0 uses the exact interval", async () => {
  const delays: number[] = [];
  const handlers = new Map<string, (signal: NodeJS.Signals) => void>();
  let cycles = 0;

  const fakeSetTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
    delays.push(Number(ms));
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  await runWorkerLoop({
    worker: "sync",
    intervalMs: 5_000,
    jitterMs: 0,
    random: () => {
      throw new Error("jitter 0 must not consume randomness");
    },
    cycle: async () => {
      cycles += 1;
      if (cycles === 2) handlers.get("SIGINT")?.("SIGINT");
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    process: {
      on: (signal: string, handler: (value: NodeJS.Signals) => void) =>
        handlers.set(signal, handler),
      off: () => undefined,
      exit: () => undefined,
    } as unknown as Pick<NodeJS.Process, "on" | "off" | "exit">,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    exit: () => undefined,
  });

  assert.equal(delays[0], 5_000);
});
