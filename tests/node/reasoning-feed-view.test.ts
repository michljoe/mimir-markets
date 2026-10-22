import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedView,
  compareFeedItems,
  confidencePercent,
  filterFeed,
  freshnessLabel,
  shortHash,
  type FeedItem,
} from "../../lib/reasoning/feed-view";
import { agentLabel, agentOptions } from "../../lib/reasoning/agent-label";

const NOW = 1_800_000_000_000;

function item(overrides: Partial<FeedItem> & { eventId: string }): FeedItem {
  return {
    agentId: "stoic",
    track: "philosopher",
    stage: "pre_stake",
    position: "creator",
    confidenceBps: 7_200,
    summary: "the source supports the creator",
    uncertainty: "the source may be revised",
    evidence: [
      { domain: "example.org", url: "https://example.org/a", capturedAt: NOW - 60_000, contentHash: "0xabcdef1234567890" },
    ],
    beforeStake: true,
    createdAt: 1_000,
    ...overrides,
  };
}

test("the feed splits before-stake from after-stake reasoning", () => {
  const view = buildFeedView([
    item({ eventId: "a", beforeStake: true, createdAt: 1_000 }),
    item({ eventId: "b", beforeStake: false, createdAt: 2_000, stage: "vote" }),
  ]);
  assert.deepEqual(view.groups.map((g) => g.phase), ["before", "after"]);
});

test("before-stake comes first so a reader can see which led", () => {
  // Reasoning published after the money is a different claim to reasoning that
  // preceded it, and the order is what makes that visible.
  const view = buildFeedView([
    item({ eventId: "late", beforeStake: false, createdAt: 500 }),
    item({ eventId: "early", beforeStake: true, createdAt: 9_000 }),
  ]);
  assert.equal(view.groups[0].phase, "before");
});

test("an empty phase produces no group rather than an empty heading", () => {
  const view = buildFeedView([item({ eventId: "a", beforeStake: true })]);
  assert.equal(view.groups.length, 1);
});

test("items are chronological with a deterministic tiebreak", () => {
  const view = buildFeedView([
    item({ eventId: "z", createdAt: 5_000 }),
    item({ eventId: "a", createdAt: 5_000 }),
    item({ eventId: "m", createdAt: 1_000 }),
  ]);
  assert.deepEqual(view.groups[0].items.map((i) => i.eventId), ["m", "a", "z"]);
});

test("ordering is by time then id", () => {
  assert.ok(compareFeedItems(item({ eventId: "b", createdAt: 1 }), item({ eventId: "a", createdAt: 2 })) < 0);
  assert.ok(compareFeedItems(item({ eventId: "b", createdAt: 1 }), item({ eventId: "a", createdAt: 1 })) > 0);
});

test("an event with no evidence is shown and counted", () => {
  // Hiding unsourced reasoning would make the feed look uniformly well-sourced.
  const view = buildFeedView([
    item({ eventId: "a" }),
    item({ eventId: "b", evidence: [] }),
  ]);
  assert.equal(view.total, 2);
  assert.equal(view.withoutEvidence, 1);
});

// ── Filters ───────────────────────────────────────────────────────────────────

test("filtering by agent is case-insensitive", () => {
  const items = [item({ eventId: "a", agentId: "Stoic" }), item({ eventId: "b", agentId: "bayesian" })];
  assert.deepEqual(filterFeed(items, { agentId: "stoic" }).map((i) => i.eventId), ["a"]);
});

test("filtering by track keeps the philosopher and council feeds separate", () => {
  const items = [
    item({ eventId: "a", track: "philosopher" }),
    item({ eventId: "b", track: "council" }),
  ];
  assert.deepEqual(filterFeed(items, { track: "council" }).map((i) => i.eventId), ["b"]);
});

test("filtering by phase selects one side of the stake", () => {
  const items = [
    item({ eventId: "a", beforeStake: true }),
    item({ eventId: "b", beforeStake: false }),
  ];
  assert.deepEqual(filterFeed(items, { phase: "after" }).map((i) => i.eventId), ["b"]);
});

test("filter options list every agent even while one is selected", () => {
  // Otherwise selecting an agent empties the control that selected it.
  const items = [item({ eventId: "a", agentId: "stoic" }), item({ eventId: "b", agentId: "bayesian" })];
  const view = buildFeedView(items, { agentId: "stoic" });
  assert.deepEqual(view.agents, ["bayesian", "stoic"]);
  assert.equal(view.total, 1);
});

test("blank agent ids do not become a filter option", () => {
  const view = buildFeedView([item({ eventId: "a", agentId: "  " }), item({ eventId: "b" })]);
  assert.deepEqual(view.agents, ["stoic"]);
});

// ── Agent label resolver ────────────────────────────────────────────────

test("agent label resolves a directory entry to its display name", () => {
  const names = new Map([["agent-1", "Trader One"]]);
  assert.equal(agentLabel("agent-1", names), "Trader One");
});

test("agent label resolves a council persona slug via the persona roster", () => {
  assert.equal(agentLabel("optimist", new Map()), "The Optimist");
});

test("agent label resolves a philosopher slug via the persona roster", () => {
  assert.equal(agentLabel("socrates", new Map()), "Socrates");
});

test("agent label falls back to the id for unknown agents", () => {
  assert.equal(agentLabel("no-such-agent", new Map()), "no-such-agent");
});

test("directory data wins over the persona roster", () => {
  const names = new Map([["optimist", "Custom Optimist"]]);
  assert.equal(agentLabel("optimist", names), "Custom Optimist");
});

test("agent options sort by display name and keep ids as values", () => {
  const names = new Map([
    ["b", "Beta"],
    ["a", "Alpha"],
  ]);
  const options = agentOptions(["b", "a"], names);
  assert.deepEqual(options.map((o) => o.id), ["a", "b"]);
  assert.deepEqual(options.map((o) => o.label), ["Alpha", "Beta"]);
});

test("unknown ids remain selectable under their own id", () => {
  const options = agentOptions(["mystery"], new Map());
  assert.deepEqual(options, [{ id: "mystery", label: "mystery" }]);
});

// ── Display helpers ───────────────────────────────────────────────────────────

test("confidence is shown as percent, not basis points", () => {
  assert.equal(confidencePercent(7_250), 73);
  assert.equal(confidencePercent(10_000), 100);
});

test("freshness uses the largest sensible unit", () => {
  assert.deepEqual(freshnessLabel({ capturedAt: NOW - 30_000 }, NOW), { unit: "seconds", value: 30 });
  assert.deepEqual(freshnessLabel({ capturedAt: NOW - 600_000 }, NOW), { unit: "minutes", value: 10 });
  assert.deepEqual(freshnessLabel({ capturedAt: NOW - 7_200_000 }, NOW), { unit: "hours", value: 2 });
  assert.deepEqual(freshnessLabel({ capturedAt: NOW - 3 * 86_400_000 }, NOW), { unit: "days", value: 3 });
});

test("an explicit freshness from the agent wins over the capture time", () => {
  // The agent knows when the SOURCE was published; capture time is when we read it.
  assert.deepEqual(
    freshnessLabel({ capturedAt: NOW - 1_000, freshnessSeconds: 86_400 * 2 }, NOW),
    { unit: "days", value: 2 },
  );
});

test("unknown age returns null instead of claiming freshness", () => {
  // "captured just now" on evidence of unknown age is a lie a reader would act on.
  assert.equal(freshnessLabel({ capturedAt: 0 }, NOW), null);
});

test("a capture time in the future clamps to zero rather than going negative", () => {
  assert.deepEqual(freshnessLabel({ capturedAt: NOW + 60_000 }, NOW), { unit: "seconds", value: 0 });
});

test("a content hash is shortened without dropping its ends", () => {
  assert.equal(shortHash("0xabcdef1234567890"), "abcdef…7890");
  assert.equal(shortHash("0xabcd"), "abcd");
});
