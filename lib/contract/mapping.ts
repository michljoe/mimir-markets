/**
 * Claim mapping helpers.
 *
 * Transforms raw claim records returned by the generated bindings into the
 * VS-friendly shapes used throughout the application.
 */

import type { RawClaim, VSClaim } from "./client";

export function mapClaimToVS(raw: RawClaim): VSClaim {
  return {
    id: raw.id.toString(),
    claimant: raw.claimant,
    amount: raw.amount.toString(),
    status: raw.status,
    createdAt: Number(raw.createdAt),
  };
}
