/**
 * Sports finality detection for the oracle.
 *
 * Pure and deterministic: `now` (epoch seconds) is injected so grace-window
 * boundaries are testable without touching the clock. Evidence text is read
 * with small, explicit heuristics — no LLM, no network — so the oracle's
 * "is the match over?" decision is pinned by tests rather than a model's mood.
 *
 * Sports betting closes at kickoff, so a claim can expire while the match is
 * still live. Settle only once the evidence shows a final result, unless we're
 * past `SPORTS_SETTLE_GRACE_SECS` past the deadline, at which point a data
 * outage must not lock funds forever.
 */

export const SPORTS_SETTLE_GRACE_HOURS_DEFAULT = 12

/** Grace window in seconds, honoring SPORTS_SETTLE_GRACE_HOURS (default 12h). */
export const SPORTS_SETTLE_GRACE_SECS =
  Math.max(1, Number(process.env.SPORTS_SETTLE_GRACE_HOURS ?? SPORTS_SETTLE_GRACE_HOURS_DEFAULT)) * 3600

/** Claim fields the check needs. */
export interface SportsClaim {
  /** Settlement deadline, epoch seconds. */
  deadline: number
}

/**
 * True when the oracle should treat the sports event as final and settle.
 *
 *   - past the grace window → true (never lock funds on an outage)
 *   - evidence shows a concluded match → true
 *   - evidence shows live / upcoming / postponed → false (defer)
 *   - anything unrecognised → false (defer; the safe default)
 */
export function isSportsEventFinal(claim: SportsClaim, evidenceText: string, now: number): boolean {
  const pastGrace = now > claim.deadline + SPORTS_SETTLE_GRACE_SECS
  if (pastGrace) return true
  return eventLooksFinal(evidenceText)
}

const NOT_FINAL_MARKERS = /\bpostponed\b|\bdelayed\b|\bsuspended\b|\bupcoming\b|\bscheduled\b|\btbd\b/i
const FINAL_MARKERS = /\bfinal\s*score\b|\bfinal\b|full.?time|\bft\b/i
const LIVE_MARKERS = /\blive\b|\bin progress\b|\bquarter\b|\bhalftime\b|half.?time|\bminute\b/i

/** Heuristic read of the evidence text: is the event conclusively over? */
function eventLooksFinal(text: string): boolean {
  if (text.trim().length === 0) return false
  if (NOT_FINAL_MARKERS.test(text)) return false
  if (FINAL_MARKERS.test(text)) return true
  if (LIVE_MARKERS.test(text)) return false
  return false
}
