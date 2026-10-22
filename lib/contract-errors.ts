/**
 * Contract-backed actionable copy for Rust-side Soroban errors.
 *
 * Source of truth for the mapping is `contracts-soroban/mimir-market/src/types.rs`
 * (and `mimir-squad/src/types.rs`) `pub enum Error`; the generated `sdk/contracts/*`
 * `Errors` object is the exact mirror used at the binding boundary, so every key we
 * cover exists on chain as well as in the generated file.
 *
 * The mapping is pure: no `console`, no `fetch`, no wallet import. Callers that do
 * need a network-readable error shape (server routes) compose `createApiError`
 * from the `code` and `userMessage` here; callers that render to the UI compose
 * from `userMessage` and `category`.
 */

/** Every contract error carries a machine-readable category for UI/analytics. */
export type ContractErrorCategory =
  | "unsupported_token"
  | "unsupported_decimals"
  | "insufficient_creation_liquidity"
  | "stake_too_small"
  | "deadline_in_past"
  | "empty_question"
  | "claim_not_found"
  | "claim_not_open"
  | "self_challenge"
  | "already_challenged"
  | "claim_full"
  | "challenge_window_closed"
  | "invalid_invite_key"
  | "duel_needs_equal_stake"
  | "claim_not_active"
  | "not_yet_expired"
  | "invalid_verdict"
  | "not_creator"
  | "nothing_to_withdraw"
  | "no_fees"
  | "payout_exceeds_escrow"
  | "overflow"
  | "invite_key_too_long"
  | "zero_stake"
  | "claim_not_resolved"
  | "not_a_challenger"
  | "already_claimed_payout"
  | "challengers_did_not_win"
  | "fee_cap_exceeded"
  | "fee_needs_recipient"
  | "nothing_queued"
  | "timelocked"
  | "fee_policy_not_ready"
  | "chain_unavailable"
  | "invalid_request";

/**
 * The actionable contract error surfaced to users and serializers.
 *
 * `code` is a compact, stable id (e.g. `claim_not_open`) that survives JSON
 * round-trips and is what server routes turn into `createApiError(code, msg)`.
 * `category` is the machine-facing bucket used for grouping and analytics.
 * `userMessage` is the copy a person can actually act on; it is never raw Rust.
 * `fallbackUserMessage` exists for unexpected Rust variants: map then default so
 * we never surface a raw `Err(...)` string as user copy.
 */
export interface ContractError {
  code: ContractErrorCategory;
  category: ContractErrorCategory;
  message: string;
  userMessage: string;
  fallbackUserMessage: string;
  retryable: boolean;
  field?: string;
}

/**
 * The runtime surface callers construct when a Soroban `Err` crosses into the
 * app without throwing a raw string.
 */
export interface ContractWriteError {
  readonly kind: "contract_write";
  readonly error: ContractError;
  pending?: boolean;
}

export interface ContractReadError {
  readonly kind: "contract_read";
  readonly error: ContractError;
}

export function isContractWriteError(value: unknown): value is ContractWriteError {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (value as ContractWriteError).kind === "contract_write"
  );
}

export function isContractReadError(value: unknown): value is ContractReadError {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (value as ContractReadError).kind === "contract_read"
  );
}

/** True when a value is a `ContractError` (bare, read, or write). */
export function isContractError(value: unknown): value is ContractError {
  return (
    isContractReadError(value) ||
    isContractWriteError(value) ||
    isPlainContractError(value)
  );
}

/** True when a value is a plain (non-wrapped) `ContractError`: it carries the
 * `code`, `category`, `userMessage`, and `retryable` shape but no `kind` tag.
 */
export function isPlainContractError(value: unknown): value is ContractError {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    "category" in value &&
    "message" in value &&
    "userMessage" in value &&
    "fallbackUserMessage" in value &&
    "retryable" in value
  );
}

/** Fallback copy for a Rust error we did not enumerate: actionable, never raw. */
function fallbackUserMessage(category: ContractErrorCategory): string {
  switch (category) {
    case "claim_not_found":
      return "We could not read that challenge. Check the link or load the market again.";
    case "claim_not_open":
      return "This challenge is closed to new stakes. Review the current state before acting.";
    case "self_challenge":
      return "You cannot challenge your own claim. Open a challenge against another claim.";
    case "invalid_invite_key":
      return "That invite link is not valid. Ask the creator for the current invite link.";
    case "duel_needs_equal_stake":
      return "A duel needs a stake that exactly matches the creator's. Adjust your stake and try again.";
    case "challenge_window_closed":
      return "The challenge window is closed. This claim is no longer accepting challenges.";
    case "invalid_verdict":
      return "The verdict you tried to record is not valid. Confirm the winner side and try again.";
    case "nothing_to_withdraw":
      return "There is nothing parked for you yet. Withdrawals from funded markets stay open.";
    case "no_fees":
      return "There are no accrued fees to claim right now.";
    case "payout_exceeds_escrow":
      return "The payout that was attempted is larger than the money held by the market. This is a contract state issue; try again with a smaller amount.";
    case "overflow":
      return "The requested action would exceed what the contract can hold. Reduce the amount and try again.";
    case "invite_key_too_long":
      return "That invite key is too long. Use a shorter invite link.";
    case "zero_stake":
      return "Stake must be greater than zero.";
    case "claim_not_resolved":
      return "That action only works after the market has been resolved.";
    case "not_a_challenger":
      return "You are not listed as a challenger on this claim, so you cannot pull this payout.";
    case "already_claimed_payout":
      return "This challenger already collected their settlement.";
    case "challengers_did_not_win":
      return "The challenger side did not win this claim, so this payout was not awarded.";
    case "fee_cap_exceeded":
      return "Fee policy changes are capped at the configured limit. Reduce the total fee and try again.";
    case "fee_needs_recipient":
      return "A fee recipient must be set before this policy can be queued.";
    case "nothing_queued":
      return "There is no fee policy waiting to be applied.";
    case "timelocked":
      return "This fee policy is still inside its approved time window. Try again after it opens.";
    case "fee_policy_not_ready":
      return "The queued fee policy is not ready yet. Wait for the stated window to open.";
    case "chain_unavailable":
      return "We could not reach the contract. Retry in a moment, or check the network settings.";
    case "unsupported_token":
    case "unsupported_decimals":
    case "stake_too_small":
    case "deadline_in_past":
    case "empty_question":
    case "already_challenged":
    case "claim_full":
    case "not_yet_expired":
    case "not_creator":
    case "overflow":
    case "not_a_challenger":
    case "no_fees":
    case "payout_exceeds_escrow":
    case "nothing_queued":
    case "timelocked":
    case "fee_policy_not_ready":
    case "invalid_request":
    default:
      return "This contract state is not actionable right now. Retry or review the current state.";
  }
}

/**
 * Map a Soroban Rust `Err` payload to a typed, actionable `ContractError`.
 *
 * `raw` is the value that `unwrap()`/`unwrapOrNull()` receives as `error`:
 * commonly a `{ message: string }` object bound by the generated SDK, but it can
 * also be a plain string or some other JSON-serialisable payload.
 */
export function contractErrorFromRustError(
  raw: unknown,
  category: ContractErrorCategory,
  field?: string,
): ContractError {
  const message = extractRustMessage(raw);
  const messageFallback = fallbackUserMessage(category);
  // `message` here is the raw Rust diagnosis. Only `userMessage` is shown to a
  // person; it is the mapped, actionable copy. `code` and `field` feed the
  // machine error shape (server routes call `createApiError` from these).
  const userMessage =
    category === "chain_unavailable"
      ? "The contract is temporarily unavailable. Refresh and try again."
      : message
        ? generateActionableCopy(category, message, field)
        : messageFallback;

  return {
    code: category,
    category,
    message,
    userMessage,
    fallbackUserMessage: messageFallback,
    retryable: false,
    field,
  };
}

function extractRustMessage(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    if ("message" in raw && typeof (raw as { message: unknown }).message === "string") {
      return (raw as { message: string }).message;
    }
    // Serde bindings can return the enum variant as a plain object too.
    const keys = Object.keys(raw);
    if (keys.length === 1) {
      const [k] = keys;
      if (typeof k === "string" && /^[A-Z]/.test(k)) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === "string") return v;
      }
    }
  }
  return JSON.stringify(raw);
}

/**
 * Turn "error" into the copy the user should read. Deterministic, no side effects.
 * Start with the top actionable failure so a user is never handed a cascade.
 */
function generateActionableCopy(
  category: ContractErrorCategory,
  message: string,
  field?: string,
): string {
  const normalized = message.trim().toLowerCase();

  if (category === "unsupported_token") {
    if (/token|asset|currency/i.test(normalized)) {
      return (
        "The token this market is configured for cannot be accepted. " +
        "This market only supports the configured asset. Choose another market."
      );
    }
    return (
      "This market is configured for a single asset. " +
      "Please select a market that supports the asset you want to use."
    );
  }

  if (category === "unsupported_decimals") {
    return (
      "This market requires the expected token scale. " +
      "Please use the configured asset so your amount is read correctly."
    );
  }

  if (category === "insufficient_creation_liquidity") {
    if (/creator|liquidity|capacity/i.test(normalized)) {
      return (
        "This creator liquidity is not sufficient for the amount you offered. " +
        "Reduce your stake or choose a market with more attached capacity."
      );
    }
    return (
      "There is not enough space for your stake here. " +
      "Lower the amount or choose a market with more available capacity."
    );
  }

  if (category === "stake_too_small") {
    return (
      "Your stake is below the minimum. " +
      "Enter at least the configured minimum stake for this market."
    );
  }

  if (category === "deadline_in_past") {
    return (
      "The deadline is in the past. " +
      "Use a future deadline so the marketplace can accept the entry."
    );
  }

  if (category === "empty_question") {
    return "Every challenge needs a question. Write the outcome you want to settle, then try again.";
  }

  if (category === "claim_not_found") {
    return "We could not read that challenge. Check the link or load the market again.";
  }

  if (category === "claim_not_open") {
    return "This challenge is closed to new stakes. Review the current state before acting.";
  }

  if (category === "self_challenge") {
    return "You cannot challenge your own claim. Open a challenge against another claim.";
  }

  if (category === "already_challenged") {
    return "A challenger has already entered this challenge. Join the existing challenge instead.";
  }

  if (category === "claim_full") {
    return "This market has reached the maximum number of challengers. Choose another one or wait for a slot to open.";
  }

  if (category === "challenge_window_closed") {
    return "The challenge window is closed. This claim is no longer accepting challenges.";
  }

  if (category === "invalid_invite_key") {
    return "That invite link is not valid. Ask the creator for the current invite link.";
  }

  if (category === "duel_needs_equal_stake") {
    return "A duel needs a stake that exactly matches the creator's. Adjust your stake and try again.";
  }

  if (category === "claim_not_active") {
    return "This challenge is no longer active for new stakes. Review the current state first.";
  }

  if (category === "not_yet_expired") {
    return "This deadline has not ended yet, so that action cannot be taken now.";
  }

  if (category === "invalid_verdict") {
    return "The verdict you tried to record is not valid. Confirm the winner side and try again.";
  }

  if (category === "not_creator") {
    return "Only the creator of this challenge can perform that action.";
  }

  if (category === "nothing_to_withdraw") {
    return "There is nothing parked for you yet. Withdrawals from funded markets stay open.";
  }

  if (category === "no_fees") {
    return "There are no accrued fees to claim right now.";
  }

  if (category === "payout_exceeds_escrow") {
    return (
      "The payout that was attempted is larger than the money held by the market. " +
      "This is a contract state issue; try again with a smaller amount."
    );
  }

  if (category === "overflow") {
    return (
      "The requested action would exceed what the contract can hold. " +
      "Reduce the amount and try again."
    );
  }

  if (category === "invite_key_too_long") {
    return "That invite key is too long. Use a shorter invite link.";
  }

  if (category === "zero_stake") {
    return "Stake must be greater than zero.";
  }

  if (category === "claim_not_resolved") {
    return "That action only works after the market has been resolved.";
  }

  if (category === "not_a_challenger") {
    return "You are not listed as a challenger on this claim, so you cannot pull this payout.";
  }

  if (category === "already_claimed_payout") {
    return "This challenger already collected their settlement.";
  }

  if (category === "challengers_did_not_win") {
    return (
      "The challenger side did not win this claim, so this payout was not awarded. " +
      "Check the final outcome before collecting."
    );
  }

  if (category === "fee_cap_exceeded") {
    return "Fee policy changes are capped at the configured limit. Reduce the total fee and try again.";
  }

  if (category === "fee_needs_recipient") {
    return "A fee recipient must be set before this policy can be queued.";
  }

  if (category === "nothing_queued") {
    return "There is no fee policy waiting to be applied.";
  }

  if (category === "timelocked") {
    return "This fee policy is still inside its approved time window. Try again after it opens.";
  }

  if (category === "fee_policy_not_ready") {
    return "The queued fee policy is not ready yet. Wait for the stated window to open.";
  }

  if (category === "chain_unavailable") {
    return "The contract is temporarily unavailable. Refresh and try again.";
  }

  if (category === "invalid_request") {
    return "This request cannot be completed as written. Check the input and try again.";
  }

  // Fallback for any unmapped message: same contract-backed pattern as the rest
  // of the map, never a raw Rust string.
  return fallbackUserMessage(category);
}

/**
 * Create a `ContractError` without touching `console` or the chain layer, so it
 * is safe to call from pure tests and from server routes alike.
 */

/**
 * Build a `ContractReadError` for an `unwrapOrNull` failure.
 */
export function contractReadErrorFromRustError(
  raw: unknown,
  category: ContractErrorCategory,
  field?: string,
): ContractReadError {
  return { kind: "contract_read", error: contractErrorFromRustError(raw, category, field) };
}

/**
 * Build a `ContractWriteError` for a `sendCall` failure.
 */
export function contractWriteErrorFromRustError(
  raw: unknown,
  category: ContractErrorCategory,
  pending = false,
  field?: string,
): ContractWriteError {
  return {
    kind: "contract_write",
    error: contractErrorFromRustError(raw, category, field),
    pending,
  };
}

/**
 * Group contract errors by the action they block so UI and analytics can
 * aggregate without touching the chain layer.
 */
export function categoryForError(error: ContractError): ContractErrorCategory {
  switch (error.category) {
    case "chain_unavailable":
      return "chain_unavailable";
    default:
      return error.category;
  }
}

/**
 * Labels surfaced on the UI to give a user a plain-language reason for a
 * contract-backed failure.
 */

/**
 * The machine-facing category for a contract error bucketed by the method
 * name that triggered it (e.g. `get_platform_stats` -> `networkUnavailable`).
 */
export function categoryForLabel(label: string): ContractErrorCategory {
  return label === "get_platform_stats" ? "chain_unavailable" : (label as ContractErrorCategory);
}

/**
 * Labels surfaced on the UI to give a user a plain-language reason for a
 * contract-backed failure.
 */
export const CONTRACT_ERROR_LABELS: Record<string, string> = {
  chain_unavailable: "The contract is temporarily unavailable. Refresh and try again.",
  networkUnavailable: "No contract configured. Check your network and try again.",
  stale: "This data is stale. The contract answered, but the result may be older than the freshness window.",
  dependencyFailed: "We could not read this from the contract right now. Retry or check your connection.",
  invalid: "The data returned by the contract is not valid here. Retry or check the claim ID.",
};

/**
 * Create a `ContractError` without touching `console` or the chain layer, so it
 * is safe to call from pure tests and from server routes alike.
 */
export function createContractError(
  category: ContractErrorCategory,
  message: string,
  opts: { field?: string } = {},
): ContractError {
  return contractErrorFromRustError({ message }, category, opts.field);
}
