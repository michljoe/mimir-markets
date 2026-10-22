import assert from "node:assert/strict";
import test from "node:test";

import { isSportsEventFinal, SPORTS_SETTLE_GRACE_SECS } from "../../agents/oracle/sports-finality";

const DEADLINE = 1_000_000; // epoch seconds, well within the grace window by default
const withinGrace = DEADLINE + 1_000; // ~17 min after deadline, inside 12h grace
const pastGrace = DEADLINE + SPORTS_SETTLE_GRACE_SECS + 1; // one second past grace
const graceBoundary = DEADLINE + SPORTS_SETTLE_GRACE_SECS; // exactly at the boundary

function claim(deadline = DEADLINE) {
  return { deadline, category: "sports" };
}

test("sports grace window default is twelve hours", () => {
  assert.equal(SPORTS_SETTLE_GRACE_SECS, 12 * 3600);
});

// ── Final evidence → settle ───────────────────────────────────────────

test("final score text is treated as final", () => {
  assert.equal(isSportsEventFinal(claim(), "Final: Lakers 102, Celtics 99", withinGrace), true);
});

test("final score label is treated as final", () => {
  assert.equal(isSportsEventFinal(claim(), "Final score: 2-1", withinGrace), true);
});

test("full time text is treated as final", () => {
  assert.equal(isSportsEventFinal(claim(), "Full time: 1-1", withinGrace), true);
});

test("FT abbreviation is treated as final", () => {
  assert.equal(isSportsEventFinal(claim(), "FT 3-2", withinGrace), true);
});

// ── Not-final evidence → defer ────────────────────────────────────────

test("live in-progress text is not final", () => {
  assert.equal(isSportsEventFinal(claim(), "Live: 2nd quarter, 6:12 remaining", withinGrace), false);
});

test("in-progress minute text is not final", () => {
  assert.equal(isSportsEventFinal(claim(), "Match in progress — 58th minute", withinGrace), false);
});

test("postponed text is not final", () => {
  assert.equal(
    isSportsEventFinal(claim(), "Postponed due to weather, new date TBD", withinGrace),
    false,
  );
});

test("scheduled/upcoming text is not final", () => {
  assert.equal(isSportsEventFinal(claim(), "Scheduled for 8pm ET tomorrow", withinGrace), false);
});

test("empty evidence is not final", () => {
  assert.equal(isSportsEventFinal(claim(), "", withinGrace), false);
});

// ── Grace window boundaries → settle regardless of evidence ───────────

test("one second past the grace window settles even with live evidence", () => {
  assert.equal(isSportsEventFinal(claim(), "Live: 2nd quarter", pastGrace), true);
});

test("exactly at the grace boundary is not past grace and still defers", () => {
  assert.equal(isSportsEventFinal(claim(), "Live: 2nd quarter", graceBoundary), false);
});
