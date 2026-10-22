/**
 * Native share (Web Share API) detection.
 *
 * `navigator.share` is missing on desktop Firefox and in any non-secure context,
 * so ShareMarket keeps its intent URLs as a fallback. Detection lives here rather
 * than inline in the component so it can be unit tested without a DOM.
 */

/** The only surface we depend on: a callable `share`. */
export interface NativeShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => unknown;
}

/**
 * True when the given navigator exposes the Web Share API. SSR-safe: pass
 * `null`/`undefined` when there is no `navigator` (server render) and it returns
 * false, which is why the component must probe inside an effect rather than
 * during render.
 */
export function supportsNativeShare(navigatorLike: unknown): boolean {
  if (typeof navigatorLike !== "object" || navigatorLike === null) return false;
  return typeof (navigatorLike as NativeShareCapableNavigator).share === "function";
}
