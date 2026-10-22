/**
 * Jitter for worker poll cycles.
 *
 * `npm run workers` starts the oracle, market-creator, council, sync and trader
 * loops at the same instant via `concurrently`. Every one of them polls on a fixed
 * interval, so left alone they scan the same RPC and call the same LLM quota in
 * lockstep forever — a restart re-synchronises them, and a rate limit takes all
 * five out together.
 *
 * Jitter spreads each scheduled cycle by a small, configurable amount:
 *
 *   next cyclen at intervalMs ± jitterMs
 *
 * Defaults to 10% of the interval. `*_POLL_JITTER_MS=0` restores the old fixed
 * scheduling exactly, which is what a test (or an operator debugging a
 * scheduling-sensitive worker) wants.
 *
 * The random source is injectable so the computation can be tested with a seeded
 * PRNG instead of asserting on Math.random.
 */

/** Default spread: ±10% of the interval. */
export const DEFAULT_POLL_JITTER_RATIO = 0.1;

export interface JitteredIntervalOptions {
  intervalMs: number;
  /** ± spread in milliseconds. Omitted means {@link defaultPollJitterMs}. */
  jitterMs?: number;
  /** Uniform [0, 1) random source. Injectable for seeded tests. */
  random?: () => number;
}

/** 10% of the interval, rounded to whole milliseconds. */
export function defaultPollJitterMs(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return Math.round(intervalMs * DEFAULT_POLL_JITTER_RATIO);
}

/**
 * Resolve a worker's jitter from its `*_POLL_JITTER_MS` value.
 *
 * - unset or blank → the 10% default
 * - a finite non-negative number → that many milliseconds
 * - anything else → the default (a typo must not silently change scheduling to
 *   "no jitter" or to an enormous spread)
 *
 * Clamped to the interval, so the shortest possible delay is zero rather than
 * negative.
 */
export function resolvePollJitterMs(
  intervalMs: number,
  raw: string | undefined | null,
): number {
  const fallback = defaultPollJitterMs(intervalMs);
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;

  const ceiling = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.round(intervalMs) : 0;
  return Math.min(Math.round(parsed), ceiling);
}

/**
 * One cycle's delay: `intervalMs` moved by a uniform offset in ± `jitterMs`.
 *
 * With `jitterMs === 0` this is exactly `intervalMs` — no `Math.random` call, so
 * a seeded test can assert fixed scheduling. The result is clamped at zero and
 * rounded to whole milliseconds, because timers do not take fractions.
 */
export function jitteredIntervalMs(options: JitteredIntervalOptions): number {
  const { intervalMs } = options;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;

  const ceiling = Math.round(intervalMs);
  const requested = options.jitterMs ?? defaultPollJitterMs(intervalMs);
  const jitterMs = Math.max(0, Math.min(Math.round(requested), ceiling));
  if (jitterMs === 0) return ceiling;

  const random = options.random ?? Math.random;
  // random() ∈ [0, 1) → offset ∈ [-jitter, +jitter)
  const offset = (random() * 2 - 1) * jitterMs;
  return Math.max(0, Math.round(intervalMs + offset));
}
