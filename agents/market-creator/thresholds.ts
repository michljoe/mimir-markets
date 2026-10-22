/**
 * Pure threshold helpers extracted from the market-creator worker.
 *
 * These are used to sanity-check the USD thresholds that the LLM proposes for
 * crypto markets. They are pure (no I/O) so they can be tested in isolation.
 */

export interface ExtractedThreshold {
  /** Numeric value in USD. */
  value: number;
  /** The raw matched string, e.g. "$120k". */
  raw: string;
}

const SUFFIXES: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

/**
 * Extract every USD threshold mentioned in a string.
 *
 * Handles the forms the LLM actually emits: `$1200`, `$1,200`, $1200`,
 * $120k, $1.2m, $1.2b, and decimals like $0.50.
 */
export function extractUsdThresholds(text: string): ExtractedThreshold[] {
  if (!text) return [];

  const results: ExtractedThreshold[] = [];
  // Match $ followed by a number with optional commas/decimals and an optional
  // magnitude suffix (k/m/b). Word boundary at the end so $120k doesn't match
  // the "120" prefix as a separate entry.
  const pattern = /\$\s?(\d{1,3}(?:,\d{3})*)(?:\.(\d+))?\s*([kKmMbG])?(?![A-Za-z0-9])/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const integerPart = match[1].replace(/,/g, "");
    const decimalPart = match[2] ? `.${match[2]}` : "";
    const base = Number.parseFloat(`${integerPart}${decimalPart}`);
    if (!Number.isFinite(base)) continue;

    const suffix = match[3]?.toLowerCase();
    const multiplier = suffix ? SUFFIXES[suffix] ?? 1 : 1;
    const value = base * multiplier;
    if (!Number.isFinite(value) || value <= 0) continue;

    results.push({ value, raw: match[0].trim() });
  }

  return results;
}

/**
 * Return a human-readable reason when a threshold is unsafe for a crypto
 * market, or null when it is fine.
 *
 * The rules mirror the inline checks the worker used to perform:
 *   - thresholds must be positive and finite
 *   - thresholds below $1 are not meaningful for a crypto price market
 *   - thresholds above $10 billion are not credible for a single asset
 */
export function cryptoThresholdReason(threshold: number): string | null {
  if (!Number.isFinite(threshold)) {
    return "threshold is not a finite number";
  }
  if (threshold <= 0) {
    return "threshold must be positive";
  }
  if (threshold < 1) {
    return "threshold below $1 is not meaningful for a crypto market";
  }
  if (threshold > 10_000_000_000) {
    return "threshold above $10b is not credible for a single asset";
  }
  return null;
}
