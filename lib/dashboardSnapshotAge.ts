/**
 * Formats the age of a dashboard snapshot for UI copy (relative, locale-aware).
 *
 * Contract:
 * - `ageMs` must be a finite, non-negative number; otherwise an empty
 *   string is returned (invalid/unknown state).
 * - `locale` must be a valid BCP 47 locale; if `Intl` cannot resolve it,
 *   we fall back to "en" so rendering never breaks (failure-tolerant
 *   dependency).
 * - The result is always a non-empty string for valid inputs, so the
 *   UI can show stable feedback without flickering.
 *
 * Thresholds:
 * - under 60 seconds -> seconds (at least 1)
 * - under 60 minutes -> minutes
 * - under 48 hours -> hours
 * - 48 hours or more -> days
 */
export function formatDashboardSnapshotAge(
  ageMs: number,
  locale: string
): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "";
  }
  let resolvedLocale = locale;
  try {
    resolvedLocale = Intl.getCanonicalLocales(locale)[0] ?? "en";
  } catch {
    resolvedLocale = "en";
  }
  const secTotal = Math.floor(ageMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: "auto" });
  if (secTotal < 60) {
    return rtf.format(-Math.max(1, secTotal), "second");
  }
  const min = Math.floor(secTotal / 60);
  if (min < 60) {
    return rtf.format(-min, "minute");
  }
  const hours = Math.floor(min / 60);
  if (hours < 48) {
    return rtf.format(-hours, "hour");
  }
  const days = Math.floor(hours / 24);
  return rtf.format(-days, "day");
}
