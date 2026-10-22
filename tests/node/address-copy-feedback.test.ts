/**
 * tests/node/address-copy-feedback.test.ts
 *
 * Unit tests for the AddressChip message-selection helper and accessible feedback.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  copyAddressActionLabel,
  copyFeedbackMessage,
  copyStatusMessage,
  getCopyFeedbackMessage,
  getCopyStatusMessage,
  type CopyFeedbackStatus,
} from "../../lib/wallet-aria";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const chipSource = read("components/ui/AddressChip.tsx");

/* ── 1. Message selection for copy feedback ───────────────────────────────── */

test("message-selection helper: success announcement without label", () => {
  assert.equal(copyFeedbackMessage("success"), "Address copied");
  assert.equal(copyFeedbackMessage("copied"), "Address copied");
  assert.equal(copyFeedbackMessage(true), "Address copied");
});

test("message-selection helper: success announcement with context label", () => {
  assert.equal(copyFeedbackMessage("success", "creator"), "creator address copied");
  assert.equal(copyFeedbackMessage("success", "agent wallet"), "agent wallet address copied");
  assert.equal(copyFeedbackMessage("success", "  winner  "), "winner address copied");
});

test("message-selection helper: failure announcement without label", () => {
  assert.equal(copyFeedbackMessage("error"), "Failed to copy address");
  assert.equal(copyFeedbackMessage("failure"), "Failed to copy address");
  assert.equal(copyFeedbackMessage("failed"), "Failed to copy address");
});

test("message-selection helper: failure announcement with context label", () => {
  assert.equal(copyFeedbackMessage("error", "creator"), "Failed to copy creator address");
  assert.equal(copyFeedbackMessage("error", "owner"), "Failed to copy owner address");
  assert.equal(copyFeedbackMessage("error", "  oracle  "), "Failed to copy oracle address");
});

test("message-selection helper: idle state returns empty string to stay silent", () => {
  assert.equal(copyFeedbackMessage("idle"), "");
  assert.equal(copyFeedbackMessage("idle", "creator"), "");
  assert.equal(copyFeedbackMessage(false), "");
  assert.equal(copyFeedbackMessage(null as unknown as CopyFeedbackStatus), "");
  assert.equal(copyFeedbackMessage(undefined as unknown as CopyFeedbackStatus), "");
});

test("message-selection helper: aliases reference the same helper function", () => {
  assert.equal(copyStatusMessage, copyFeedbackMessage);
  assert.equal(getCopyFeedbackMessage, copyFeedbackMessage);
  assert.equal(getCopyStatusMessage, copyFeedbackMessage);
});

/* ── 2. Action label stability ────────────────────────────────────────────── */

test("action label: describes action and remains stable regardless of state", () => {
  const address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  assert.equal(
    copyAddressActionLabel(address),
    `Copy address ${address}`,
  );
  assert.equal(
    copyAddressActionLabel(address, "creator"),
    `Copy creator address ${address}`,
  );
  assert.equal(
    copyAddressActionLabel(address, "  owner  "),
    `Copy owner address ${address}`,
  );
});

/* ── 3. Component accessibility wiring regressions ────────────────────────── */

test("AddressChip renders a visually hidden role='status' region with no layout shift", () => {
  assert.match(chipSource, /role="status"/);
  assert.match(chipSource, /className="[^"]*\bsr-only\b[^"]*"/);
  assert.match(chipSource, /aria-live="polite"/);
});

test("AddressChip keeps button aria-label stable and does not swap it to state text", () => {
  // Before: aria-label={copied ? "Address copied" : ...}
  assert.equal(
    chipSource.includes('aria-label={copied ? "Address copied"'),
    false,
    "button aria-label must not swap to 'Address copied'",
  );
  assert.match(
    chipSource,
    /aria-label=\{copyAddressActionLabel\(address, label\)\}/,
  );
});

test("AddressChip handles both clipboard success and failure feedback", () => {
  assert.match(chipSource, /setCopyStatus\("success"\)/);
  assert.match(chipSource, /setCopyStatus\("error"\)/);
});
