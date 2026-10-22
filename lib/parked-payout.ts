/**
 * View model for the parked-payout section of the payout card.
 *
 * When a USDC push fails (frozen or deauthorized trustline), `escrow::push_or_park`
 * parks the amount as a withdrawable balance instead of reverting the settlement,
 * and the beneficiary must later pull it with `withdraw(who)`. The on-chain
 * answer is `get_withdrawable(address)`; this helper decides when the UI should
 * surface it.
 *
 * Kept pure and separate from the component so the decision is unit-testable
 * without a wallet, an RPC, or a renderer — same shape as
 * `lib/usdcTrustlineGate.ts`.
 */

export interface ParkedPayoutInput {
  /** Connected wallet address, or null when no wallet. */
  address: string | null;
  /** Parked amount for that address in display USDC (`getWithdrawable`). */
  withdrawable: number;
}

export interface ParkedPayoutView {
  /** Show the parked-payout section: funded, connected, and actually parked. */
  visible: boolean;
  /** The parked amount in display USDC; 0 when hidden. */
  amount: number;
}

/**
 * The section shows only for a connected wallet with a strictly positive parked
 * balance. Zero means "nothing parked" — the normal state — and hiding it keeps
 * the payout card focused on the claim; a failed or partial read must never
 * render a phantom balance, so non-finite values are treated as zero.
 */
export function evaluateParkedPayout(input: ParkedPayoutInput): ParkedPayoutView {
  const amount =
    Number.isFinite(input.withdrawable) && input.withdrawable > 0
      ? input.withdrawable
      : 0;
  return { visible: Boolean(input.address) && amount > 0, amount };
}

/** Default inputs for tests: connected wallet with nothing parked. */
export function parkedPayoutFixture(
  overrides: Partial<ParkedPayoutInput> = {},
): ParkedPayoutInput {
  return {
    address: "GMOCK",
    withdrawable: 0,
    ...overrides,
  };
}
