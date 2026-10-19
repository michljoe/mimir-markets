/**
 * Per-instance memoization for expensive async reads (chain scans, RPC
 * fan-outs) that return values `unstable_cache` can't safely store — e.g.
 * bigint fields, which JSON.stringify throws on.
 *
 * Deduped per warm serverless instance only, not shared across instances.
 * That's an acceptable tradeoff here: it still collapses N concurrent/rapid
 * page views into one chain round-trip instead of N.
 */
export function cachedFor<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  ttlMs: number
): (...args: Args) => Promise<T> {
  const cache = new Map<string, { value: Promise<T>; expiresAt: number }>();

  return (...args: Args) => {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }

    const value = fn(...args);
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  };
}

/**
 * Short-lived in-memory cooldown keyed by an arbitrary string. Used to
 * dedupe repeated triggers (e.g. per-claim refresh requests) within a
 * window without paying for the underlying work again.
 *
 * Like `cachedFor`, this is per-instance only. That's fine for a best-effort
 * cooldown: it still dedupes the common case of a script hitting one warm
 * instance in a tight loop.
 */
export function createCooldown(ttlMs: number) {
  const seen = new Map<string, number>();

  /**
   * Returns `true` if the key was already seen within the cooldown window
   * (so the caller should skip the work on this call), or `false` if this
   * is a fresh key and the caller may proceed.
   */
  return (key: string): boolean => {
    const now = Date.now();
    const expiresAt = seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return true;
    }

    // Opportunistic pruning so the map doesn't grow unbounded on a warm
    // instance.
    if (seen.size > 1000) {
      for (const [k, exp] of seen.entries()) {
        if (exp <= now) seen.delete(k);
      }
    }

    seen.set(key, now + ttlMs);
    return false;
  };
}
