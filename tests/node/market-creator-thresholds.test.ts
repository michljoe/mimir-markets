import test from "node:test";
import assert from "node:assert";

import {
  extractUsdThresholds,
  cryptoThresholdReason,
} from "../../agents/market-creator/thresholds.js";

test("extractUsdThresholds parses plain dollar amounts", () => {
  const result = extractUsdThresholds("Will BTC close above $1200 this week?");
  assert.deepStrictEqual(result.map((r) => r.value), [1200]);
});

test("extractUsdThresholds handles commas and decimals", () => {
  const result = extractUsdThresholds("$1,200.50 or $0.25?");
  assert.deepStrictEqual(result.map((r) => r.value), [1200.5, 0.25]);
});

test("extractUsdThresholds expands magnitude suffixes", () => {
  const result = extractUsdThresholds("$120k or $1.5m or $2.7b");
  assert.deepStrictEqual(result.map((r) => r.value), [120_000, 1_500_000, 2_700_000_000]);
});

test("extractUsdThresholds returns empty for text without thresholds", () => {
  assert.deepStrictEqual(extractUsdThresholds("Will the launch happen this week?"), []);
});

test("cryptoThresholdReason accepts reasonable thresholds", () => {
  assert.strictEqual(cryptoThresholdReason(1200), null);
  assert.strictEqual(cryptoThresholdReason(1), null);
  assert.strictEqual(cryptoThresholdReason(10_000_000_000), null);
});

test("cryptoThresholdReason rejects non-positive thresholds", () => {
  assert.matches(cryptoThresholdReason(Number.NaN) ?? "", /finite/);
  assert.matches(cryptoThresholdReason(0) ?? "", /positive/);
  assert.matches(cryptoThresholdReason(-1) ?? "", /positive/);
});

test("cryptoThresholdReason rejects thresholds outside the sane band", () => {
  assert.matches(cryptoThresholdReason(0.5) ?? "", /below \$1+/);
  assert.matches(cryptoThresholdReason(10_000_000_001) ?? "", /above \$10b/);
});
