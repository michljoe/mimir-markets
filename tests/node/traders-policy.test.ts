/**
 * tests/node/traders-policy.test.ts
 *
 * Unit tests for pure trader policy predicates in agents/traders/policy.ts:
 * 1. shouldBuySecondOpinion predicate (BUY_SECOND_OPINION, MIMIR_URL, DRY_RUN, claim fields)
 *    ensuring TRADER_DRY_RUN=1 spends nothing.
 * 2. filterJoinableClaims filtering logic.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  filterJoinableClaims,
  shouldBuySecondOpinion,
  type JoinableClaimCandidate,
  type SecondOpinionClaimFields,
} from "../../agents/traders/policy";

const VALID_CLAIM: SecondOpinionClaimFields = {
  question: "Will Stellar exceed 100k daily operations?",
  creator_position: "Yes",
  counter_position: "No",
  resolution_url: "https://stellar.expert/explorer/public",
  settlement_rule: "Based on StellarExpert ledger data.",
};

const TRADER_WALLET = "GDYJ7GZ4WDGYFE6R3HFBUK2GYMFIFP3JHFYSYAME6XISG5BEKZDJVGHN";
const OTHER_WALLET = "GB5DLP3MNPUXXJ6P67XGD3OV3ZVIMZN3NZDLVDIYQN6JSC2M7QMMBL4E";

test("shouldBuySecondOpinion: returns true when all conditions are satisfied in non-dry-run mode", () => {
  const result = shouldBuySecondOpinion({
    buySecondOpinion: true,
    mimirUrl: "https://mimir.example.com",
    dryRun: false,
    claim: VALID_CLAIM,
  });
  assert.equal(result, true);
});

test("shouldBuySecondOpinion: returns false when dryRun is true (never spends in dry-run)", () => {
  const result = shouldBuySecondOpinion({
    buySecondOpinion: true,
    mimirUrl: "https://mimir.example.com",
    dryRun: true,
    claim: VALID_CLAIM,
  });
  assert.equal(result, false);
});

test("shouldBuySecondOpinion: returns false when buySecondOpinion is false", () => {
  const result = shouldBuySecondOpinion({
    buySecondOpinion: false,
    mimirUrl: "https://mimir.example.com",
    dryRun: false,
    claim: VALID_CLAIM,
  });
  assert.equal(result, false);
});

test("shouldBuySecondOpinion: returns false when mimirUrl is unset or empty", () => {
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "",
      dryRun: false,
      claim: VALID_CLAIM,
    }),
    false,
  );
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "   ",
      dryRun: false,
      claim: VALID_CLAIM,
    }),
    false,
  );
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: null,
      dryRun: false,
      claim: VALID_CLAIM,
    }),
    false,
  );
});

test("shouldBuySecondOpinion: returns false when claim or required claim fields are missing", () => {
  // missing claim entirely
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "https://mimir.example.com",
      dryRun: false,
      claim: null,
    }),
    false,
  );

  // missing question
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "https://mimir.example.com",
      dryRun: false,
      claim: { ...VALID_CLAIM, question: null },
    }),
    false,
  );
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "https://mimir.example.com",
      dryRun: false,
      claim: { ...VALID_CLAIM, question: "" },
    }),
    false,
  );

  // missing resolution_url
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "https://mimir.example.com",
      dryRun: false,
      claim: { ...VALID_CLAIM, resolution_url: null },
    }),
    false,
  );
  assert.equal(
    shouldBuySecondOpinion({
      buySecondOpinion: true,
      mimirUrl: "https://mimir.example.com",
      dryRun: false,
      claim: { ...VALID_CLAIM, resolution_url: "  " },
    }),
    false,
  );
});

test("shouldBuySecondOpinion: supports positional argument signature", () => {
  // Valid non-dry-run
  assert.equal(
    shouldBuySecondOpinion(true, "https://mimir.example.com", false, VALID_CLAIM),
    true,
  );

  // Dry-run returns false
  assert.equal(
    shouldBuySecondOpinion(true, "https://mimir.example.com", true, VALID_CLAIM),
    false,
  );

  // Disabled buying returns false
  assert.equal(
    shouldBuySecondOpinion(false, "https://mimir.example.com", false, VALID_CLAIM),
    false,
  );
});

test("filterJoinableClaims: filters out claims too close to deadline (<= 300s)", () => {
  const now = 1_000_000;
  const claims: JoinableClaimCandidate[] = [
    { id: 1, deadline: now + 300, creator: OTHER_WALLET, visibility: "public" },
    { id: 2, deadline: now + 299, creator: OTHER_WALLET, visibility: "public" },
    { id: 3, deadline: now + 301, creator: OTHER_WALLET, visibility: "public" },
  ];
  const challengers = new Map<number, { address: string }[]>();

  const filtered = filterJoinableClaims(claims, challengers, TRADER_WALLET, now);
  assert.deepEqual(filtered.map((c) => c.id), [3]);
});

test("filterJoinableClaims: filters out claims created by the trader", () => {
  const now = 1_000_000;
  const claims: JoinableClaimCandidate[] = [
    { id: 1, deadline: now + 1000, creator: TRADER_WALLET, visibility: "public" },
    { id: 2, deadline: now + 1000, creator: OTHER_WALLET, visibility: "public" },
  ];
  const challengers = new Map<number, { address: string }[]>();

  const filtered = filterJoinableClaims(claims, challengers, TRADER_WALLET, now);
  assert.deepEqual(filtered.map((c) => c.id), [2]);
});

test("filterJoinableClaims: filters out non-public claims", () => {
  const now = 1_000_000;
  const claims: JoinableClaimCandidate[] = [
    { id: 1, deadline: now + 1000, creator: OTHER_WALLET, visibility: "private" },
    { id: 2, deadline: now + 1000, creator: OTHER_WALLET, visibility: "public" },
  ];
  const challengers = new Map<number, { address: string }[]>();

  const filtered = filterJoinableClaims(claims, challengers, TRADER_WALLET, now);
  assert.deepEqual(filtered.map((c) => c.id), [2]);
});

test("filterJoinableClaims: filters out claims already challenged by this trader", () => {
  const now = 1_000_000;
  const claims: JoinableClaimCandidate[] = [
    { id: 1, deadline: now + 1000, creator: OTHER_WALLET, visibility: "public" },
    { id: 2, deadline: now + 1000, creator: OTHER_WALLET, visibility: "public" },
  ];
  const challengers = new Map<number, { address: string }[]>([
    [1, [{ address: TRADER_WALLET }]],
    [2, [{ address: "SOME_OTHER_CHALLENGER" }]],
  ]);

  const filtered = filterJoinableClaims(claims, challengers, TRADER_WALLET, now);
  assert.deepEqual(filtered.map((c) => c.id), [2]);
});
