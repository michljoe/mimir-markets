import assert from "node:assert/strict";
import test from "node:test";

import { kellyFraction } from "../../lib/kelly";

test("no edge at 50% confidence on even odds", () => {
  assert.equal(kellyFraction(50, 0.25), 0);
});

test("negative edge clamps to zero, never a negative bet", () => {
  assert.equal(kellyFraction(30, 0.25), 0);
  assert.equal(kellyFraction(0, 0.25), 0);
});

test("positive edge below the cap returns the raw Kelly fraction", () => {
  // p=0.6, q=0.4, b=1 → f = 0.2
  assert.ok(Math.abs(kellyFraction(60, 1.0) - 0.2) < 1e-12);
});

test("the cap bounds aggressive edges", () => {
  // p=0.8 → raw f = 0.6, capped per caller
  assert.equal(kellyFraction(80, 0.25), 0.25);
  assert.equal(kellyFraction(80, 0.15), 0.15);
});

test("100% confidence bets exactly the cap", () => {
  assert.equal(kellyFraction(100, 0.25), 0.25);
});

test("returns 0 when netOdds is zero, negative, or not finite", () => {
  assert.equal(kellyFraction(80, 0.25, 0), 0);
  assert.equal(kellyFraction(80, 0.25, -1), 0);
  assert.equal(kellyFraction(80, 0.25, Number.NaN), 0);
  assert.equal(kellyFraction(80, 0.25, Number.POSITIVE_INFINITY), 0);
  assert.equal(kellyFraction(80, 0.25, Number.NEGATIVE_INFINITY), 0);
});

test("returns 0 when cap is zero, negative, or not finite", () => {
  assert.equal(kellyFraction(80, 0), 0);
  assert.equal(kellyFraction(80, -0.25), 0);
  assert.equal(kellyFraction(80, Number.NaN), 0);
  assert.equal(kellyFraction(80, Number.POSITIVE_INFINITY), 0);
  assert.equal(kellyFraction(80, Number.NEGATIVE_INFINITY), 0);
});

test("returns 0 when confidence is not finite", () => {
  assert.equal(kellyFraction(Number.NaN, 0.25), 0);
  assert.equal(kellyFraction(Number.POSITIVE_INFINITY, 0.25), 0);
  assert.equal(kellyFraction(Number.NEGATIVE_INFINITY, 0.25), 0);
});

test("clamps confidence to 0..100 range", () => {
  // confidence > 100 clamped to 100% confidence -> bets cap
  assert.equal(kellyFraction(150, 0.25), 0.25);
  // confidence < 0 clamped to 0% confidence -> bets 0
  assert.equal(kellyFraction(-20, 0.25), 0);
});

