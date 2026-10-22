import assert from "node:assert/strict";
import test from "node:test";

import { computeEmergingNarratives } from "../../lib/emerging-narratives";
import type { VSData } from "../../lib/contract";

const NOW = 1_000_000;
const WINDOW = 100;

function market(overrides: Partial<VSData> = {}): VSData {
  return {
    id: 1,
    creator: "creator",
    opponent: "opponent",
    question: "Will the event happen?",
    creator_position: "Yes",
    opponent_position: "No",
    resolution_url: "https://example.com",
    stake_amount: 2,
    deadline: NOW + WINDOW,
    state: "open",
    winner: "",
    resolution_summary: "",
    created_at: NOW,
    category: "crypto",
    creator_stake: 10,
    total_challenger_stake: 0,
    ...overrides,
  };
}

function category(result: ReturnType<typeof computeEmergingNarratives>, id: string) {
  return result.categories.find((entry) => entry.category === id)!;
}

test("assigns exact window boundaries to the expected window", () => {
  const result = computeEmergingNarratives(
    [
      market({ id: 1, created_at: NOW - WINDOW * 2 }),
      market({ id: 2, created_at: NOW - WINDOW }),
      market({ id: 3, created_at: NOW }),
      market({ id: 4, created_at: NOW - WINDOW * 2 - 1 }),
      market({ id: 5, created_at: NOW + 1 }),
    ],
    { nowSeconds: NOW, windowSeconds: WINDOW },
  );
  const crypto = category(result, "crypto");

  assert.equal(crypto.previousMarketCount, 1);
  assert.equal(crypto.recentMarketCount, 2);
  assert.equal(result.marketCount, 3);
});

test("orders tied categories and top markets deterministically", () => {
  const result = computeEmergingNarratives(
    [
      market({ id: 9, category: "culture", creator_stake: 20, created_at: NOW - 1 }),
      market({ id: 3, category: "culture", creator_stake: 20, created_at: NOW - 1 }),
      market({ id: 8, category: "sports", creator_stake: 20, created_at: NOW - 1 }),
    ],
    { nowSeconds: NOW, windowSeconds: WINDOW },
  );

  assert.equal(result.categories[0].category, "culture");
  assert.deepEqual(category(result, "culture").topMarkets.map((item) => item.id), [3, 9]);
});

test("excludes cancelled markets from counts, stake, and top markets", () => {
  const result = computeEmergingNarratives(
    [
      market({ id: 1, creator_stake: 10 }),
      market({ id: 2, state: "cancelled", creator_stake: 9_000 }),
    ],
    { nowSeconds: NOW, windowSeconds: WINDOW },
  );
  const crypto = category(result, "crypto");

  assert.equal(result.marketCount, 1);
  assert.equal(crypto.recentStake, "100000000");
  assert.deepEqual(crypto.topMarkets.map((item) => item.id), [1]);
});

test("uses exact atomic stake totals and maps unknown categories to custom", () => {
  const result = computeEmergingNarratives(
    [market({ category: "unlisted-topic", creator_stake: Number.MAX_SAFE_INTEGER, total_challenger_stake: 4 })],
    { nowSeconds: NOW, windowSeconds: WINDOW },
  );

  assert.equal(category(result, "custom").recentStake, "90071992547409950000000");
});

test("retains seven-decimal USDC stake precision", () => {
  const result = computeEmergingNarratives(
    [market({ creator_stake: 1.25, total_challenger_stake: 0.0000003 })],
    { nowSeconds: NOW, windowSeconds: WINDOW },
  );

  assert.equal(category(result, "crypto").recentStake, "12500003");
});

test("returns every known category for empty input", () => {
  const result = computeEmergingNarratives([], { nowSeconds: NOW, windowSeconds: WINDOW });

  assert.equal(result.marketCount, 0);
  assert.deepEqual(result.categories.map((entry) => entry.category), ["crypto", "culture", "custom", "sports", "weather"]);
  assert.ok(result.categories.every((entry) => entry.momentumScoreBps === "0"));
});