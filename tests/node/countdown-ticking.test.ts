import assert from "node:assert/strict";
import test from "node:test";
import { shouldKeepTicking } from "../../lib/hooks";

test("shouldKeepTicking returns true when state exists and is not expired", () => {
  assert.equal(shouldKeepTicking({ expired: false }), true);
});

test("shouldKeepTicking returns false when state is expired", () => {
  assert.equal(shouldKeepTicking({ expired: true }), false);
});

test("shouldKeepTicking returns false for null or undefined state", () => {
  assert.equal(shouldKeepTicking(null), false);
  assert.equal(shouldKeepTicking(undefined), false);
});
