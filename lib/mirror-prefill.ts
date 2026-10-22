/*
 * Parse and validate the query params that pre-fill a
 * challenge ticket from the pending-mirror list.
 *
 * The PendingMirrors table links each row to the VS detail page
 * with `side` and `amount` query params. Those params are user
 * controlled (anyone can edit the URL), so the ticket must treat them
 * as untrusted input: a bad side is dropped, and an amount is clamped
 * to the subscription's per-market cap so a link cannot pre-fill a
 * stake larger than the user agreed to when they followed the basket.
 *
 * ADR-0008 requires every stake to be user-signed, so this only pre-fills
 * the form — it never submits or signs anything.
 */

export type ChallengeSide = "yes" | "no";

export interface MirrorPrefill {
  /** The side to pre-select, if valid. */
  side?: ChallengeSide;
  /** The amount to pre-fill, already clamped. */
  amount?: number;
}

export interface MirrorPrefillInput {
  side?: string | null;
  amount?: string | number | null;
}

/**
 * The maximum amount a mirror link may pre-fill.
 *
 * This is the subscriber's per-market cap for the basket. When it is
 * unknown or non-positive we fall back to the queue's default (2 USDC),
 * matching `pendingMirrorsFor`.
 */
export const DEFAULT_PER_MARKET_USDC = 2;

const MIN_AMOUNT_USDC = 0.01;

function normalizeSide(raw: unknown): ChallengeSide | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "yes" || value === "true" || value === "1") return "yes";
  if (value === "no" || value === "false" || value === "0") return "no";
  return undefined;
}

function parseAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve the effective per-market cap from a subscription value.
 */
export function resolvePerMarketCap(raw: unknown): number {
  const parsed = parseAmount(raw);
  if (parsed === undefined || parsed <= 0) return DEFAULT_PER_MARKET_USDC;
  return parsed;
}

/**
 * Parse the `side` and `amount` query params into a safe prefill.
 *
 * - Invalid side values are dropped.
 * - Invalid or non-positive amounts are dropped.
 * - Amounts are clamped to the per-market cap.
 * - Amounts below the minimum stake are dropped.
 */
export function parseMirrorPrefill(
  input: MirrorPrefillInput,
  perMarketCap: unknown = DEFAULT_PER_MARKET_USDC,
): MirrorPrefill {
  const result: MirrorPrefill = {};

  const side = normalizeSide(input.side);
  if (side) result.side = side;

  const cap = resolvePerMarketCap(perMarketCap);
  const amount = parseAmount(input.amount);
  if (amount !== undefined && Number.isFinite(amount) && amount > 0) {
    const clamped = Math.min(amount, cap);
    if (clamped >= MIN_AMOUNT_USDC) {
      result.amount = Math.round(clamped * 100) / 100;
    }
  }

  return result;
}
