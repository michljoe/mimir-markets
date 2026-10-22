"use client";

/**
 * "Collect your payout" — the missing half of settlement.
 *
 * The Soroban contract settles CHALLENGERS BY PULL, and this is the only UI that
 * calls it. `resolve_claim` cannot pay everyone: a Stellar transaction is capped
 * on its ledger-entry footprint, so paying ~100 challengers does not fit in one
 * invocation (see `contracts-soroban/mimir-market/src/resolve.rs`). Instead the
 * verdict seeds `remaining_escrow` and each winner draws their share down with
 * `claim_challenger_payout`. Without a button, a won market showed "Settled." and
 * the money simply stayed in escrow.
 *
 * The creator's side is still pushed at resolution, so this card is only ever for
 * a winning challenger.
 *
 * The quote is read fresh from the contract rather than derived from the feed's
 * `potential_payout`: the fee is snapshotted per claim, the last claimant absorbs
 * the truncation dust, and `claimed` is the authoritative answer to "did I
 * already take this".
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  claimChallengerPayout,
  didUserChallengeVS,
  getWithdrawable,
  quoteChallengerPayout,
  withdraw,
  type VSData,
} from "@/lib/contract";
import { evaluateParkedPayout } from "@/lib/parked-payout";
import { useWallet } from "@/lib/wallet";
import { acquireTxLock } from "@/lib/tx-lock";
import { evaluateUsdcTrustlineGate } from "@/lib/usdcTrustlineGate";
import {
  UsdcTrustlineGate,
  useUsdcTrustline,
} from "@/components/wallet/UsdcTrustlineGate";
import { Button, GlassCard } from "@/components/ui";

interface Quote {
  gross: number;
  fee: number;
  net: number;
  claimed: boolean;
}

export default function ClaimPayoutCard({
  vs,
  onCollected,
}: {
  vs: VSData;
  /** Refresh the page's claim data once the pull lands. */
  onCollected?: () => void;
}) {
  const t = useTranslations("badges");
  const tWallet = useTranslations("wallet");
  const { address, isConnected, signer } = useWallet();
  const trustline = useUsdcTrustline();
  const trustlineGate = evaluateUsdcTrustlineGate({
    action: "payout",
    status: trustline.status,
    loading: trustline.loading,
    stale: trustline.stale,
    isConnected,
    hasSigner: Boolean(signer),
  });
  // Same policy, different label: pulling a parked payout is a USDC receive just
  // like collecting, so it needs a working trustline.
  const withdrawGate = evaluateUsdcTrustlineGate({
    action: "withdraw",
    status: trustline.status,
    loading: trustline.loading,
    stale: trustline.stale,
    isConnected,
    hasSigner: Boolean(signer),
  });

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Parked amount (display USDC) and the withdraw action's lifecycle. The pull
  // is a real transaction, so it moves through the same pending/success/error
  // beats the collect button does.
  const [withdrawable, setWithdrawable] = useState(0);
  const [withdrawPhase, setWithdrawPhase] = useState<"idle" | "pending" | "success" | "error">("idle");

  // Only a winning challenger has anything to pull. Checked before the read so a
  // resolved market does not cost every viewer a contract simulation.
  const eligible =
    vs.state === "resolved" &&
    vs.winner_side === "challengers" &&
    Boolean(address) &&
    didUserChallengeVS(vs, address);

  const refresh = useCallback(async () => {
    // Read the parked balance even when the wallet has no claim to pull here: a
    // payout that was pushed and parked earlier (frozen trustline at settlement)
    // is invisible to the quote, and it is exactly the money this section exists
    // to recover. Failures are non-fatal — the amount simply stays at its last
    // value and the parent poll retries.
    if (address) {
      try {
        setWithdrawable(await getWithdrawable(address));
      } catch (err) {
        console.warn("[ClaimPayoutCard] parked read failed", err);
      }
    } else {
      setWithdrawable(0);
    }

    if (!eligible || !address) {
      setQuote(null);
      return;
    }
    setLoading(true);
    try {
      setQuote(await quoteChallengerPayout(vs.id, address));
    } catch (err) {
      // A quote failure is not worth a toast: the card simply does not appear,
      // and the poll on the parent page will try again.
      console.warn("[ClaimPayoutCard] quote failed", err);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [eligible, address, vs.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function collect() {
    if (!isConnected || !address || !signer) {
      toast.error(
        !isConnected || !address
          ? tWallet("connectWalletFirst")
          : t("walletCannotSign"),
      );
      return;
    }
    if (!trustlineGate.allowed) {
      toast.error(tWallet(trustlineGate.messageKey));
      return;
    }
    let release: (() => void) | undefined;
    try {
      release = acquireTxLock(address);
    } catch (lockErr) {
      toast.error(lockErr instanceof Error ? lockErr.message : String(lockErr));
      return;
    }
    setBusy(true);
    try {
      const result = await claimChallengerPayout(signer, vs.id);
      const hash = result.explorerTxHash || result.txHash;
      toast.success(t("claimPayoutSuccess", { net: result.netPayout.toFixed(2) }), {
        ...(hash ? { description: `Tx: ${hash.slice(0, 10)}...${hash.slice(-8)}` } : {}),
      });
      await refresh();
      onCollected?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        /reject|denied|cancel/i.test(message)
          ? t("claimPayoutRejected")
          : message || t("claimPayoutError"),
      );
    } finally {
      setBusy(false);
      release?.();
    }
  }

  /**
   * Pull a parked payout.
   *
   * A separate action from `collect`: that one claims an unsettled payout from
   * `remaining_escrow`, this one sweeps a balance the contract already parked
   * for this wallet (frozen/deauthorized trustline at push time). They touch
   * different escrow buckets, so the button stays live even when there is
   * nothing left to collect.
   */
  async function withdrawParked() {
    if (!isConnected || !address || !signer) {
      toast.error(
        !isConnected || !address
          ? tWallet("connectWalletFirst")
          : t("walletCannotSign"),
      );
      return;
    }
    if (!withdrawGate.allowed) {
      toast.error(tWallet(withdrawGate.messageKey));
      return;
    }
    if (withdrawPhase === "pending") return;
    let release: (() => void) | undefined;
    try {
      release = acquireTxLock(address);
    } catch (lockErr) {
      toast.error(lockErr instanceof Error ? lockErr.message : String(lockErr));
      return;
    }
    setWithdrawPhase("pending");
    try {
      const result = await withdraw(signer);
      const hash = result.explorerTxHash || result.txHash;
      toast.success(tWallet("withdrawSuccess", { amount: result.amount.toFixed(2) }), {
        ...(hash ? { description: `Tx: ${hash.slice(0, 10)}...${hash.slice(-8)}` } : {}),
      });
      setWithdrawPhase("success");
      await refresh();
    } catch (err) {
      setWithdrawPhase("error");
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        /reject|denied|cancel/i.test(message)
          ? t("parkedWithdrawRejected")
          : message || t("parkedWithdrawError"),
      );
    } finally {
      release?.();
    }
  }

  const parked = evaluateParkedPayout({ address, withdrawable });

  if (!eligible) return null;

  let claimCard: ReactNode = null;
  if (loading && !quote) {
    claimCard = (
      <GlassCard glass className="!rounded-2xl border border-pv-emerald/20 text-center">
        <p className="text-sm text-pv-muted">{t("claimPayoutChecking")}</p>
      </GlassCard>
    );
  } else if (quote?.claimed) {
    claimCard = (
      <GlassCard glass className="!rounded-2xl border border-pv-ink/[0.12] text-center">
        <p className="text-sm text-pv-muted">{t("claimPayoutCollected")}</p>
      </GlassCard>
    );
  } else if (quote && quote.net > 0) {
    claimCard = (
      <GlassCard glass className="!rounded-2xl border border-pv-emerald/35">
        <UsdcTrustlineGate trustline={trustline} className="mb-3" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-pv-text">{t("claimPayoutTitle")}</div>
            <p className="mt-1 text-sm text-pv-muted">{t("claimPayoutHint")}</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-pv-muted">
              {t("claimPayoutBreakdown", {
                gross: quote.gross.toFixed(2),
                fee: quote.fee.toFixed(2),
              })}
            </p>
          </div>
          <Button
            variant="emerald"
            onClick={collect}
            loading={busy}
            disabled={!trustlineGate.allowed}
            fullWidth={false}
          >
            {busy
              ? t("claimPayoutPending")
              : t("claimPayoutCta", { net: quote.net.toFixed(2) })}
          </Button>
        </div>
      </GlassCard>
    );
  }
  // A resolved-and-unclaimed quote of zero means this challenger lost the market
  // even though their side won (a partial-fill edge in fixed-odds mode), so
  // claimCard stays null — there is nothing to offer and no point saying so.

  const parkedCard = parked.visible ? (
    <GlassCard
      glass
      className="!rounded-2xl border border-pv-amber/35"
      data-testid="parked-payout-card"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-pv-text">{t("parkedPayoutTitle")}</div>
          <p className="mt-1 text-sm text-pv-muted">{t("parkedPayoutHint")}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-pv-muted">
            {tWallet("withdrawable")}: {parked.amount.toFixed(2)} USDC
          </p>
        </div>
        <Button
          variant="emerald"
          onClick={() => void withdrawParked()}
          loading={withdrawPhase === "pending"}
          disabled={!withdrawGate.allowed}
          fullWidth={false}
        >
          {withdrawPhase === "pending"
            ? tWallet("pending")
            : tWallet("withdrawCta", { amount: parked.amount.toFixed(2) })}
        </Button>
      </div>
    </GlassCard>
  ) : null;

  if (!claimCard && !parkedCard) return null;

  return (
    <div className="flex flex-col gap-3">
      {parkedCard}
      {claimCard}
    </div>
  );
}
