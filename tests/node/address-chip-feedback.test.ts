import assert from "node:assert/strict";
import test from "node:test";

import {
  getAddressCopyFeedback,
  type CopyState,
} from "../../components/ui/AddressChip";

test("getAddressCopyFeedback returns empty string for idle state", () => {
  assert.equal(getAddressCopyFeedback("idle"), "");
  assert.equal(getAddressCopyFeedback("idle", { label: "creator" }), "");
  assert.equal(getAddressCopyFeedback("idle", { label: "" }), "");
});

test("getAddressCopyFeedback announces success without label", () => {
  assert.equal(getAddressCopyFeedback("success"), "Address copied");
  assert.equal(getAddressCopyFeedback("success", {}), "Address copied");
  assert.equal(getAddressCopyFeedback("success", { label: "" }), "Address copied");
});

test("getAddressCopyFeedback announces success with specific role/context label", () => {
  assert.equal(
    getAddressCopyFeedback("success", { label: "creator" }),
    "creator address copied"
  );
  assert.equal(
    getAddressCopyFeedback("success", { label: "proposer" }),
    "proposer address copied"
  );
  assert.equal(
    getAddressCopyFeedback("success", { label: "agent" }),
    "agent address copied"
  );
});

test("getAddressCopyFeedback announces failure without label", () => {
  assert.equal(getAddressCopyFeedback("error"), "Failed to copy address");
  assert.equal(getAddressCopyFeedback("error", {}), "Failed to copy address");
  assert.equal(getAddressCopyFeedback("error", { label: "" }), "Failed to copy address");
});

test("getAddressCopyFeedback announces failure with specific role/context label", () => {
  assert.equal(
    getAddressCopyFeedback("error", { label: "creator" }),
    "Failed to copy creator address"
  );
  assert.equal(
    getAddressCopyFeedback("error", { label: "proposer" }),
    "Failed to copy proposer address"
  );
  assert.equal(
    getAddressCopyFeedback("error", { label: "agent" }),
    "Failed to copy agent address"
  );
});

test("getAddressCopyFeedback handles unknown or undefined states gracefully", () => {
  assert.equal(getAddressCopyFeedback("" as unknown as CopyState), "");
  assert.equal(getAddressCopyFeedback(undefined as unknown as CopyState), "");
});
