/**
 * Kelly Criterion: f* = (p * b - q) / b
 *   p = probability of winning (confidence/100)
 *   q = 1 - p
 *   b = net odds (payout ratio - 1, e.g. pool odds ≈ 1.0 for even)
 *
 * Returns the fraction of bankroll to bet (0–1), clamped to `cap`.
 * Callers pick their own safety cap (oracle 0.25, council personas 0.15).
 */
export function kellyFraction(confidencePct: number, cap: number, netOdds = 1.0): number {
  if (!Number.isFinite(confidencePct) || !Number.isFinite(cap) || !Number.isFinite(netOdds)) {
    return 0;
  }
  if (cap <= 0 || netOdds <= 0) {
    return 0;
  }
  const clampedConfidence = Math.max(0, Math.min(100, confidencePct));
  const p = clampedConfidence / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(cap, f));
}

