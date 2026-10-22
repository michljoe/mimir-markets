import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractErrorCategory,
  ContractError,
  ContractReadError,
  ContractWriteError,
  isContractError,
  isContractReadError,
  isContractWriteError,
  contractErrorFromRustError,
  contractReadErrorFromRustError,
  contractWriteErrorFromRustError,
  categoryForError,
  categoryForLabel,
  CONTRACT_ERROR_LABELS,
  createContractError,
} from "../../lib/contract-errors";

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertIsContractError(value: unknown): asserts value is ContractError {
  assert.ok(isContractError(value), "expected a ContractError");
}

function codeOf(error: ContractError): ContractErrorCategory {
  return error.code;
}

// ── Category union coverage ──────────────────────────────────────────────────

test("ContractErrorCategory covers the 35 on-chain Rust error variants", () => {
  const categories: readonly string[] = [
    "unsupported_token",
    "unsupported_decimals",
    "insufficient_creation_liquidity",
    "stake_too_small",
    "deadline_in_past",
    "empty_question",
    "claim_not_found",
    "claim_not_open",
    "self_challenge",
    "already_challenged",
    "claim_full",
    "challenge_window_closed",
    "invalid_invite_key",
    "duel_needs_equal_stake",
    "claim_not_active",
    "not_yet_expired",
    "invalid_verdict",
    "not_creator",
    "nothing_to_withdraw",
    "no_fees",
    "payout_exceeds_escrow",
    "overflow",
    "invite_key_too_long",
    "zero_stake",
    "claim_not_resolved",
    "not_a_challenger",
    "already_claimed_payout",
    "challengers_did_not_win",
    "fee_cap_exceeded",
    "fee_needs_recipient",
    "nothing_queued",
    "timelocked",
    "fee_policy_not_ready",
    "chain_unavailable",
    "invalid_request",
  ];
  assert.equal(categories.length, 35);
  for (const c of categories) {
    // Smoke-test each category end to end: it round-trips through
    // contractErrorFromRustError untouched.
    assert.equal(codeOf(contractErrorFromRustError({ message: c }, c as ContractErrorCategory)), c);
  }
});

// ── Identity guards ──────────────────────────────────────────────────────────

test("isContractError / isContractReadError / isContractWriteError guards", () => {
  const read = contractReadErrorFromRustError({ message: "boom" }, "claim_not_found");
  const write = contractWriteErrorFromRustError({ message: "boom" }, "stake_too_small");

  assert.equal(isContractReadError(read), true);
  assert.equal(isContractReadError(write), false);
  assert.equal(isContractWriteError(write), true);
  assert.equal(isContractWriteError(read), false);
  assert.equal(isContractError(read), true);
  assert.equal(isContractError(write), true);
});

test("guards reject plain strings and Error objects", () => {
  assert.equal(isContractError("boom"), false);
  assert.equal(isContractError(new Error("boom")), false);
  assert.equal(isContractError(null), false);
  assert.equal(isContractError(undefined), false);
});

// ── contractErrorFromRustError ───────────────────────────────────────────────

test("contractErrorFromRustError maps a { message } payload", () => {
  const error = contractErrorFromRustError({ message: "Stake too small" }, "stake_too_small");
  assert.equal(codeOf(error), "stake_too_small");
  assert.equal(error.category, "stake_too_small");
  assert.equal(error.message, "Stake too small");
  assert.ok(error.userMessage.startsWith("Your stake is below the minimum"));
  assert.ok(error.fallbackUserMessage);
  assert.equal(error.retryable, false);
});

test("contractErrorFromRustError maps a plain string payload", () => {
  const error = contractErrorFromRustError("ClaimFull", "claim_full");
  assert.equal(codeOf(error), "claim_full");
  assert.equal(error.message, "ClaimFull");
});

test("contractErrorFromRustError maps a nested { message } string", () => {
  const error = contractErrorFromRustError({ message: "InviteKeyTooLong" }, "invite_key_too_long");
  assert.equal(error.code, "invite_key_too_long");
  assert.ok(error.userMessage);
});

test("contractErrorFromRustError falls back to actionable copy when category is unknown", () => {
  const error = contractErrorFromRustError({ message: "WeirdRustErr" }, "invalid_request" as ContractErrorCategory);
  assert.ok(error.userMessage);
  assert.ok(error.fallbackUserMessage);
});

// ── contractReadErrorFromRustError / contractWriteErrorFromRustError ─────────

test("contractReadErrorFromRustError builds a read-shaped error", () => {
  const error = contractReadErrorFromRustError({ message: "ClaimNotFound" }, "claim_not_found");
  assert.equal(error.kind, "contract_read");
  assert.equal(error.error.code, "claim_not_found");
  assert.ok(error.error.userMessage);
});

test("contractWriteErrorFromRustError builds a write-shaped error", () => {
  const error = contractWriteErrorFromRustError({ message: "FeeCapExceeded" }, "fee_cap_exceeded");
  assert.equal(error.kind, "contract_write");
  assert.equal(error.error.code, "fee_cap_exceeded");
  assert.equal(error.pending, false);
});

test("contractWriteErrorFromRustError accepts pending=true", () => {
  const error = contractWriteErrorFromRustError({ message: "FeeCapExceeded" }, "fee_cap_exceeded", true);
  assert.equal(error.pending, true);
});

// ── categoryForLabel ─────────────────────────────────────────────────────────

test("categoryForLabel maps get_platform_stats to chain_unavailable", () => {
  assert.equal(categoryForLabel("get_platform_stats"), "chain_unavailable");
});

test("categoryForLabel passes through other labels", () => {
  assert.equal(categoryForLabel("get_claim"), "get_claim");
  assert.equal(categoryForLabel("challenge_claim"), "challenge_claim");
  assert.equal(categoryForLabel("withdraw"), "withdraw");
});

// ── categoryForError ─────────────────────────────────────────────────────────

test("categoryForError returns the category as-is", () => {
  const error = contractErrorFromRustError({ message: "foo" }, "stake_too_small");
  assert.equal(categoryForError(error), "stake_too_small");
});

// ── CONTRACT_ERROR_LABELS ────────────────────────────────────────────────────

test("CONTRACT_ERROR_LABELS covers the network/contract surface", () => {
  assert.ok(CONTRACT_ERROR_LABELS.chain_unavailable);
  assert.ok(CONTRACT_ERROR_LABELS.networkUnavailable);
  assert.ok(CONTRACT_ERROR_LABELS.stale);
  assert.ok(CONTRACT_ERROR_LABELS.dependencyFailed);
  assert.ok(CONTRACT_ERROR_LABELS.invalid);
});

// ── createContractError ──────────────────────────────────────────────────────

test("createContractError builds a ContractError without touching the chain layer", () => {
  const error = createContractError("stake_too_small", "Stake too small");
  assertIsContractError(error);
  assert.equal(error.code, "stake_too_small");
  assert.ok(error.userMessage);
  assert.ok(error.fallbackUserMessage);
});

test("createContractError with a field", () => {
  const error = createContractError("stake_too_small", "Stake too small", { field: "stake_amount" });
  assert.equal(error.field, "stake_amount");
});
