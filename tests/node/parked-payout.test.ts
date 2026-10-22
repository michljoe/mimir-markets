import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateParkedPayout,
  parkedPayoutFixture,
} from "../../lib/parked-payout";

test("positive: a connected wallet with a non-zero parked balance shows the section", () => {
  const result = evaluateParkedPayout(parkedPayoutFixture({ withdrawable: 10 }));

  assert.equal(result.visible, true);
  assert.equal(result.amount, 10);
});

test("negative: nothing parked hides the section", () => {
  const result = evaluateParkedPayout(parkedPayoutFixture({ withdrawable: 0 }));

  assert.equal(result.visible, false);
  assert.equal(result.amount, 0);
});

test("negative: a disconnected wallet never shows parked funds, however large", () => {
  const result = evaluateParkedPayout(
    parkedPayoutFixture({ address: null, withdrawable: 42.5 }),
  );

  // The amount is still reported (it is a real on-chain balance); only the
  // section is suppressed, since there is no wallet here to withdraw into.
  assert.equal(result.visible, false);
  assert.equal(result.amount, 42.5);
});

test("negative: a negative or non-finite read is treated as zero, not a balance", () => {
  for (const withdrawable of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = evaluateParkedPayout(parkedPayoutFixture({ withdrawable }));
    assert.equal(result.visible, false, `withdrawable=${withdrawable}`);
    assert.equal(result.amount, 0, `withdrawable=${withdrawable}`);
  }
});

test("boundary: any strictly positive amount is visible, including sub-cent dust", () => {
  const result = evaluateParkedPayout(parkedPayoutFixture({ withdrawable: 0.0000001 }));

  assert.equal(result.visible, true);
  assert.equal(result.amount, 0.0000001);
});

test("fixture: defaults describe a connected wallet with nothing parked", () => {
  const fixture = parkedPayoutFixture();

  assert.equal(typeof fixture.address, "string");
  assert.equal(fixture.withdrawable, 0);
  assert.equal(evaluateParkedPayout(fixture).visible, false);
});
