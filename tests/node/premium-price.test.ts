import assert from "node:assert/strict";
import test from "node:test";

import { parsePriceSymbol } from "../../lib/price/parse-price-symbol";

test("parsePriceSymbol: accepts valid symbols", () => {
  assert.deepEqual(parsePriceSymbol("bitcoin"), { kind: "ok", symbol: "bitcoin" });
  assert.deepEqual(parsePriceSymbol("ethereum"), { kind: "ok", symbol: "ethereum" });
  assert.deepEqual(parsePriceSymbol("  Bitcoin  "), { kind: "ok", symbol: "bitcoin" });
});

test("parsePriceSymbol: accepts the maximum length (64)", () => {
  const max = "a".repeat(64);
  assert.deepEqual(parsePriceSymbol(max), { kind: "ok", symbol: max });
});

test("parsePriceSymbol: rejects symbols over 64 chars", () => {
  const overLong = "a".repeat(65);
  const result = parsePriceSymbol(overLong);
  assert.equal(result.kind, "invalid");
  assert.equal(result.error, "invalid symbol");
});

test("parsePriceSymbol: rejects invalid characters", () => {
  assert.deepEqual(parsePriceSymbol("BTC/USD"), { kind: "invalid", error: "invalid symbol" });
  assert.deepEqual(parsePriceSymbol(""), { kind: "invalid", error: "invalid symbol" });
  assert.deepEqual(parsePriceSymbol("bitcoin!"), { kind: "invalid", error: "invalid symbol" });
});
