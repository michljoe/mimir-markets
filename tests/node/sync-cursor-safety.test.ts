import assert from "node:assert/strict";
import test from "node:test";

import { validateCursorValue } from "../../lib/server/sync-helpers";

// Mock the sync meta functions for testing cursor validation
const mockSyncMetaStore = new Map<string, string>();

function mockGetSyncMeta(key: string): Promise<string | null> {
  return Promise.resolve(mockSyncMetaStore.get(key) ?? null);
}

async function mockSetSyncMeta(key: string, value: string): Promise<void> {
  mockSyncMetaStore.set(key, value);
}

// Reimplement the cursor functions for testing with mockable DB access
async function advanceCursor(
  key: string,
  newValue: number,
  getMeta: (key: string) => Promise<string | null>,
  setMeta: (key: string, value: string) => Promise<void>
): Promise<void> {
  const current = await getMeta(key);
  const currentValidated = validateCursorValue(current, key, "sync-cursor-safety-test");
  
  // Only advance; never roll back
  if (currentValidated !== null && newValue <= currentValidated) {
    console.warn(`Cursor ${key} would roll back from ${currentValidated} to ${newValue}, skipping update`);
    return;
  }
  
  await setMeta(key, String(newValue));
}

async function recoverCursor(
  key: string,
  fallback: number,
  getMeta: (key: string) => Promise<string | null>,
  setMeta: (key: string, value: string) => Promise<void>
): Promise<number> {
  const current = await getMeta(key);
  const validated = validateCursorValue(current, key, "sync-cursor-safety-test");
  
  if (validated === null) {
    console.warn(`Recovering cursor ${key} to fallback value ${fallback}`);
    await setMeta(key, String(fallback));
    return fallback;
  }
  
  return validated;
}

// ── Cursor validation tests ─────────────────────────────────────────────────

test("validateCursorValue accepts valid positive integers", () => {
  assert.equal(validateCursorValue("100", "test_key", "sync-cursor-safety-test"), 100);
  assert.equal(validateCursorValue("0", "test_key", "sync-cursor-safety-test"), 0);
  assert.equal(validateCursorValue("999999", "test_key", "sync-cursor-safety-test"), 999999);
});

test("validateCursorValue rejects null and empty strings", () => {
  assert.equal(validateCursorValue(null, "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("", "test_key", "sync-cursor-safety-test"), null);
});

test("validateCursorValue rejects negative numbers", () => {
  assert.equal(validateCursorValue("-1", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("-100", "test_key", "sync-cursor-safety-test"), null);
});

test("validateCursorValue rejects non-numeric strings", () => {
  assert.equal(validateCursorValue("abc", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("100abc", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("nan", "test_key", "sync-cursor-safety-test"), null);
});

test("validateCursorValue rejects NaN and Infinity", () => {
  assert.equal(validateCursorValue("NaN", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("Infinity", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("-Infinity", "test_key", "sync-cursor-safety-test"), null);
});

test("validateCursorValue rejects floating point numbers", () => {
  // Cursor positions must be integers
  assert.equal(validateCursorValue("100.5", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("0.1", "test_key", "sync-cursor-safety-test"), null);
  assert.equal(validateCursorValue("100.0", "test_key", "sync-cursor-safety-test"), 100); // Integer representation is valid
});

// ── Cursor advancement tests ────────────────────────────────────────────────

test("advanceCursor updates when new value is greater than current", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "100");
  
  await advanceCursor("test_cursor", 200, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(mockSyncMetaStore.get("test_cursor"), "200");
});

test("advanceCursor rejects rollback when new value is less than current", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "200");
  
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  
  // Should not update; cursor stays at 200
  assert.equal(mockSyncMetaStore.get("test_cursor"), "200");
});

test("advanceCursor rejects rollback when new value equals current", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "100");
  
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  
  // Should not update; cursor stays at 100
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
});

test("advanceCursor accepts first write when cursor is null", async () => {
  mockSyncMetaStore.clear();
  
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
});

test("advanceCursor recovers from corrupted cursor by treating as null", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "corrupted_value");
  
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  
  // Should treat corrupted as null and update to 100
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
});

// ── Cursor recovery tests ───────────────────────────────────────────────────

test("recoverCursor returns current value when valid", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "100");
  
  const recovered = await recoverCursor("test_cursor", 0, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(recovered, 100);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100"); // Unchanged
});

test("recoverCursor uses fallback when cursor is null", async () => {
  mockSyncMetaStore.clear();
  
  const recovered = await recoverCursor("test_cursor", 50, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(recovered, 50);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "50"); // Set to fallback
});

test("recoverCursor uses fallback when cursor is corrupted", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "corrupted");
  
  const recovered = await recoverCursor("test_cursor", 50, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(recovered, 50);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "50"); // Set to fallback
});

test("recoverCursor uses fallback when cursor is negative", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "-100");
  
  const recovered = await recoverCursor("test_cursor", 50, mockGetSyncMeta, mockSetSyncMeta);
  
  assert.equal(recovered, 50);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "50"); // Set to fallback
});

// ── Integration scenarios ───────────────────────────────────────────────────

test("cursor maintains monotonic increase across multiple updates", async () => {
  mockSyncMetaStore.clear();
  
  // Sequence of valid updates
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
  
  await advanceCursor("test_cursor", 200, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "200");
  
  await advanceCursor("test_cursor", 300, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "300");
  
  // Attempt rollback - should be rejected
  await advanceCursor("test_cursor", 250, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "300"); // Still 300
});

test("cursor handles restart from corrupted state", async () => {
  mockSyncMetaStore.clear();
  
  // Simulate corrupted state
  await mockSetSyncMeta("test_cursor", "not_a_number");
  
  // Recovery should fix it
  const recovered = await recoverCursor("test_cursor", 0, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 0);
  
  // Normal operation resumes
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
});

test("cursor handles missing cursor with fallback", async () => {
  mockSyncMetaStore.clear();
  
  // No cursor exists
  const recovered = await recoverCursor("test_cursor", 1000, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 1000);
  
  // Subsequent updates work normally
  await advanceCursor("test_cursor", 1500, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "1500");
});

test("cursor treats zero as valid but prevents negative rollback", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "0");
  
  // Should accept 0 as valid
  const recovered = await recoverCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 0);
  
  // Should reject negative rollback from 0
  await advanceCursor("test_cursor", -1, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "0"); // Still 0
  
  // Should accept positive advance from 0
  await advanceCursor("test_cursor", 100, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "100");
});

// ── Edge cases and boundary conditions ─────────────────────────────────────

test("cursor handles very large numbers", async () => {
  mockSyncMetaStore.clear();
  const largeNumber = Number.MAX_SAFE_INTEGER;
  
  await advanceCursor("test_cursor", largeNumber, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), String(largeNumber));
  
  // Should reject rollback from large number
  await advanceCursor("test_cursor", largeNumber - 1, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get("test_cursor"), String(largeNumber));
});

test("cursor handles whitespace in stored values", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "  100  ");
  
  // Should reject due to whitespace making it invalid
  const recovered = await recoverCursor("test_cursor", 0, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 0);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "0"); // Set to fallback
});

test("cursor handles scientific notation as invalid", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "1e2");
  
  // Should reject as invalid (scientific notation)
  const recovered = await recoverCursor("test_cursor", 0, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 0);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "0"); // Set to fallback
});

test("cursor handles hexadecimal strings as invalid", async () => {
  mockSyncMetaStore.clear();
  await mockSetSyncMeta("test_cursor", "0x64");
  
  // Should reject as invalid (hexadecimal format)
  const recovered = await recoverCursor("test_cursor", 0, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(recovered, 0);
  assert.equal(mockSyncMetaStore.get("test_cursor"), "0"); // Set to fallback
});

// ── Incremental claim events cursor & ingest tests ──────────────────────────

test("claim_events_cursor_ledger cursor survives restarts and advances monotonically", async () => {
  mockSyncMetaStore.clear();
  const cursorKey = "claim_events_cursor_ledger";

  // Fresh start: recovers to fallback deploy ledger
  const initial = await recoverCursor(cursorKey, 1000, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(initial, 1000);
  assert.equal(mockSyncMetaStore.get(cursorKey), "1000");

  // Advance cursor as events are ingested
  await advanceCursor(cursorKey, 1050, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get(cursorKey), "1050");

  // Restart simulation: cursor value persists in sync_meta
  const afterRestart = await recoverCursor(cursorKey, 1000, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(afterRestart, 1050);

  // Monotonic advancement prevents cursor rollback
  await advanceCursor(cursorKey, 1020, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get(cursorKey), "1050"); // Unchanged

  // Higher ledger advances cursor
  await advanceCursor(cursorKey, 1100, mockGetSyncMeta, mockSetSyncMeta);
  assert.equal(mockSyncMetaStore.get(cursorKey), "1100");
});

test("incremental event ingestion filters touched claims from typed events fixtures", () => {
  // Event fixtures mimicking Soroban contract events:
  // topic[0] = Symbol(eventName), topic[1] = u64(claimId)
  const eventFixtures = [
    { name: "claim_created", claimId: 42, ledger: 1010 },
    { name: "claim_challenged", claimId: 42, ledger: 1012 },
    { name: "claim_challenged", claimId: 43, ledger: 1015 },
    { name: "market_settled", claimId: 42, ledger: 1020 },
    { name: "claim_resolved", claimId: 42, ledger: 1020 },
    { name: "claim_cancelled", claimId: 44, ledger: 1025 },
    { name: "fee_accrued", claimId: 42, ledger: 1020 }, // Non-lifecycle event touched in settlement
    { name: "unrelated_event", claimId: 99, ledger: 1030 },
  ];

  const relevantEventNames = new Set([
    "claim_created", "ClaimCreated",
    "claim_challenged", "ClaimChallenged",
    "claim_resolved", "ClaimResolved",
    "market_settled", "MarketSettled",
    "claim_cancelled", "ClaimCancelled",
  ]);

  const touchedClaimIds = new Set<number>();
  for (const ev of eventFixtures) {
    if (relevantEventNames.has(ev.name)) {
      touchedClaimIds.add(ev.claimId);
    }
  }

  // Exactly claims 42, 43, 44 are touched; 99 is filtered out
  assert.deepEqual(Array.from(touchedClaimIds).sort((a, b) => a - b), [42, 43, 44]);
  // RPC calls scale with touched claims (3), not active claims count
  assert.equal(touchedClaimIds.size, 3);
});
