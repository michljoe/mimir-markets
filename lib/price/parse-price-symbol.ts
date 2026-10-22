/**
 * Pure validation for the premium price symbol. Safe to import from Node tests
 * (no Next.js / server-only dependencies).
 */

const MAX_SYMBOL_LENGTH = 64;
const SYMBOL_RE = /^[a-z0-9-]+$/;

export type PriceSymbolParse =
  | { kind: "ok"; symbol: string }
  | { kind: "invalid"; error: string };

export function parsePriceSymbol(raw: string): PriceSymbolParse {
  const symbol = raw.toLowerCase().trim();
  if (!SYMBOL_RE.test(symbol) || symbol.length > MAX_SYMBOL_LENGTH) {
    return { kind: "invalid", error: "invalid symbol" };
  }
  return { kind: "ok", symbol };
}
