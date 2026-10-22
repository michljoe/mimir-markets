import assert from "node:assert/strict";
import test from "node:test";

import {
  drainSettlements,
  type SettlementDrainSummary,
} from "../../agents/sync/index";
import type { SettlementSyncResult } from "../../lib/server/settlement-index";

function mockSlice(
  fromLedger: number,
  toLedger: number,
  truncated: boolean,
  overrides: Partial<SettlementSyncResult> = {},
): SettlementSyncResult {
  return {
    settlements: 1,
    accruals: 2,
    payouts: 1,
    claims: 1,
    fromLedger,
    toLedger,
    truncated,
    ...overrides,
  };
}

test("a backlog of N slices clears in one cycle when N <= max passes", async () => {
  const slices: SettlementSyncResult[] = [
    mockSlice(1000, 1100, true, { settlements: 2, accruals: 4, payouts: 1, claims: 2 }),
    mockSlice(1100, 1200, true, { settlements: 3, accruals: 6, payouts: 2, claims: 3 }),
    mockSlice(1200, 1300, false, { settlements: 1, accruals: 2, payouts: 1, claims: 1 }),
  ];

  let callCount = 0;
  const reconciler = async (): Promise<SettlementSyncResult> => {
    const slice = slices[callCount];
    callCount += 1;
    return slice;
  };

  const logs: string[] = [];
  const summary = await drainSettlements(reconciler, {
    maxPasses: 5,
    log: (msg) => logs.push(msg),
  });

  assert.ok(summary);
  assert.equal(callCount, 3, "should execute all 3 slices in one cycle");
  assert.equal(summary.passes, 3);
  assert.equal(summary.truncated, false);
  assert.equal(summary.stoppedReason, "completed");
  assert.equal(summary.settlements, 6);
  assert.equal(summary.accruals, 12);
  assert.equal(summary.payouts, 4);
  assert.equal(summary.claims, 6);
  assert.equal(summary.fromLedger, 1000);
  assert.equal(summary.toLedger, 1300, "final ledger should match the end of the last slice");

  assert.equal(logs.length, 1);
  assert.match(logs[0], /3 pass\(es\)/);
  assert.match(logs[0], /ledgers 1000→1300/);
  assert.doesNotMatch(logs[0], /truncated — will resume/);
});

test("stops at max passes when backlog exceeds limit", async () => {
  let callCount = 0;
  const reconciler = async (): Promise<SettlementSyncResult> => {
    callCount += 1;
    return mockSlice(1000 + (callCount - 1) * 100, 1000 + callCount * 100, true);
  };

  const logs: string[] = [];
  const summary = await drainSettlements(reconciler, {
    maxPasses: 2,
    log: (msg) => logs.push(msg),
  });

  assert.ok(summary);
  assert.equal(callCount, 2, "must not exceed maxPasses");
  assert.equal(summary.passes, 2);
  assert.equal(summary.truncated, true);
  assert.equal(summary.stoppedReason, "max_passes");
  assert.equal(summary.fromLedger, 1000);
  assert.equal(summary.toLedger, 1200, "final ledger must record progress up to the last executed pass");

  assert.equal(logs.length, 1);
  assert.match(logs[0], /2 pass\(es\)/);
  assert.match(logs[0], /ledgers 1000→1200/);
  assert.match(logs[0], /truncated — will resume/);
});

test("the cycle still ends within its time budget", async () => {
  let simulatedTime = 1_000_000;
  let callCount = 0;

  const reconciler = async (): Promise<SettlementSyncResult> => {
    callCount += 1;
    // Each pass consumes 60ms of simulated time
    simulatedTime += 60;
    return mockSlice(1000 + (callCount - 1) * 100, 1000 + callCount * 100, true);
  };

  const summary = await drainSettlements(reconciler, {
    maxPasses: 10,
    timeBudgetMs: 100, // Budget allows 1st pass (starts at 0ms, ends at 60ms); 2nd pass ends at 120ms >= 100ms
    now: () => simulatedTime,
    log: () => {},
  });

  assert.ok(summary);
  assert.equal(callCount, 2, "should stop after pass 2 once time budget is exceeded");
  assert.equal(summary.passes, 2);
  assert.equal(summary.truncated, true);
  assert.equal(summary.stoppedReason, "time_budget");
  assert.equal(summary.toLedger, 1200);
});

test("single untruncated slice completes in 1 pass", async () => {
  let callCount = 0;
  const reconciler = async (): Promise<SettlementSyncResult> => {
    callCount += 1;
    return mockSlice(500, 600, false, { settlements: 5, accruals: 10 });
  };

  const logs: string[] = [];
  const summary = await drainSettlements(reconciler, {
    maxPasses: 10,
    log: (msg) => logs.push(msg),
  });

  assert.ok(summary);
  assert.equal(callCount, 1);
  assert.equal(summary.passes, 1);
  assert.equal(summary.truncated, false);
  assert.equal(summary.stoppedReason, "completed");
  assert.equal(summary.settlements, 5);
  assert.equal(summary.accruals, 10);
  assert.equal(summary.fromLedger, 500);
  assert.equal(summary.toLedger, 600);
});

test("reconciler returning null yields null without throwing", async () => {
  const summary = await drainSettlements(async () => null);
  assert.equal(summary, null);
});

test("honors SYNC_MAX_SETTLEMENT_PASSES environment variable", async () => {
  const origEnv = process.env.SYNC_MAX_SETTLEMENT_PASSES;
  process.env.SYNC_MAX_SETTLEMENT_PASSES = "4";

  try {
    let callCount = 0;
    const reconciler = async (): Promise<SettlementSyncResult> => {
      callCount += 1;
      return mockSlice(callCount * 10, (callCount + 1) * 10, true);
    };

    const summary = await drainSettlements(reconciler, { log: () => {} });
    assert.ok(summary);
    assert.equal(callCount, 4);
    assert.equal(summary.passes, 4);
    assert.equal(summary.stoppedReason, "max_passes");
  } finally {
    if (origEnv !== undefined) {
      process.env.SYNC_MAX_SETTLEMENT_PASSES = origEnv;
    } else {
      delete process.env.SYNC_MAX_SETTLEMENT_PASSES;
    }
  }
});
