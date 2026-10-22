import assert from "node:assert/strict";
import test from "node:test";

import { supportsNativeShare } from "../../lib/share-market";

// ── Detection ─────────────────────────────────────────────────────────────────

test("a navigator exposing a share function is detected", () => {
  assert.equal(supportsNativeShare({ share: async () => {} }), true);
  assert.equal(supportsNativeShare({ share: () => {} }), true);
});

test("a navigator without the Web Share API is rejected", () => {
  assert.equal(supportsNativeShare({}), false);
  assert.equal(supportsNativeShare({ share: undefined }), false);
});

test("a non-callable share is rejected", () => {
  // Some polyfills expose the property without it being callable.
  assert.equal(supportsNativeShare({ share: "yes" }), false);
  assert.equal(supportsNativeShare({ share: null }), false);
});

// ── SSR / absence ─────────────────────────────────────────────────────────────

test("missing or non-object navigators are rejected without throwing", () => {
  assert.equal(supportsNativeShare(undefined), false);
  assert.equal(supportsNativeShare(null), false);
  assert.equal(supportsNativeShare("navigator"), false);
  assert.equal(supportsNativeShare(42), false);
});

// ── Regression ────────────────────────────────────────────────────────────────

test("extra navigator properties do not affect detection", () => {
  assert.equal(
    supportsNativeShare({ clipboard: {}, userAgent: "Mimir/1.0", share: () => {} }),
    true,
  );
  assert.equal(supportsNativeShare({ clipboard: {} }), false);
});
