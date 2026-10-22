/**
 * Council pass lifetime (TTL) resolution.
 *
 * `POST /api/council/subscribe` sells a time-boxed access pass. Its lifetime
 * comes from `COUNCIL_PASS_TTL_MS`, which is operator-supplied — so the raw
 * value can be a typo (`10m`), a blank string, a fraction or a negative
 * number.
 *
 * Before this module the route did `Number(process.env.COUNCIL_PASS_TTL_MS ?? …)`:
 *
 *   - a typo produced `NaN`, and that `NaN` flowed into `issuePass()` and
 *     straight back to the buyer as `ttlMs: NaN` / `expiresAt: NaN` — *after*
 *     the payment had already been taken;
 *   - a negative value issued an already-expired pass.
 *
 * Pure module: no env reads, no I/O. The route resolves the value per request
 * and the node suite table-drives the policy directly.
 */

/** Default council pass lifetime: 10 minutes. */
export const DEFAULT_COUNCIL_PASS_TTL_MS = 10 * 60 * 1000;

/**
 * Hard ceiling: 24 hours.
 *
 * A pass buys a window of free council reads, not a subscription. A lifetime
 * longer than a day is a configuration mistake rather than an intent, so it is
 * clamped instead of honoured — a typo must never mint a pass that outlives
 * the operator's own policy.
 */
export const MAX_COUNCIL_PASS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the council pass TTL from a raw env value.
 *
 * - missing / empty / blank → {@link DEFAULT_COUNCIL_PASS_TTL_MS}
 * - non-numeric (`"abc"`, `"10m"`) → default
 * - non-integer (`"1.5"`) → default
 * - non-positive (`"0"`, `"-5"`) → default
 * - above {@link MAX_COUNCIL_PASS_TTL_MS} → clamped to the cap
 * - anything else → used unchanged
 *
 * The result is always a finite positive integer, so `Date.now() + ttl` can
 * never produce a `NaN` expiry.
 */
export function resolveCouncilPassTtlMs(raw: unknown): number {
  const value = typeof raw === "string" ? raw.trim() : raw;

  if (typeof value !== "string" && typeof value !== "number") {
    return DEFAULT_COUNCIL_PASS_TTL_MS;
  }
  if (value === "") return DEFAULT_COUNCIL_PASS_TTL_MS;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return DEFAULT_COUNCIL_PASS_TTL_MS;
  }
  return Math.min(n, MAX_COUNCIL_PASS_TTL_MS);
}
