"use client";

/**
 * A wallet address you can actually do something with.
 *
 * A shortened address is unusable on its own: you cannot verify it, paste it, or
 * look it up. Two affordances, both one click — copy the full address, or open it
 * on the explorer.
 *
 * The explorer link is a real anchor rather than a scripted window.open, so
 * middle-click and "open in new tab" behave the way the rest of the web does.
 */

import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";

import { getExplorerAddressUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/constants";
import {
  copyAddressActionLabel,
  copyFeedbackMessage,
  copyStatusMessage,
  type CopyFeedbackStatus,
} from "@/lib/wallet-aria";

export {
  copyAddressActionLabel,
  copyFeedbackMessage,
  copyStatusMessage,
  type CopyFeedbackStatus,
};

export type CopyState = "idle" | "success" | "error";

export function getAddressCopyFeedback(
  state: CopyState,
  options?: { label?: string }
): string {
  if (state === "success") {
    return options?.label
      ? `${options.label} address copied`
      : "Address copied";
  }
  if (state === "error") {
    return options?.label
      ? `Failed to copy ${options.label} address`
      : "Failed to copy address";
  }
  return "";
}

export function AddressChip({
  address,
  className = "",
  label,
  linkToProfile = true,
}: {
  address: string;
  className?: string;
  /** Screen-reader context, e.g. "creator". */
  label?: string;
  /**
   * The address itself links to its Mimir profile. The explorer stays as a second
   * icon: "what has this wallet done here" is the question a market page raises,
   * and a list of raw transactions is a poor answer to it.
   *
   * Off on the profile page itself, where the link would point at the page you
   * are already reading.
   */
  linkToProfile?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState<CopyFeedbackStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function copy() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("success");
      timerRef.current = setTimeout(() => {
        setCopyStatus("idle");
        timerRef.current = null;
      }, 1600);
    } catch {
      setCopyStatus("error");
      timerRef.current = setTimeout(() => {
        setCopyStatus("idle");
        timerRef.current = null;
      }, 1600);
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[11px] text-pv-muted ${className}`}>
      {linkToProfile ? (
        <Link
          href={`/profile/${address}`}
          title={`View ${label ? `${label} ` : ""}profile`}
          className="transition-colors hover:text-pv-emerald focus-ring"
        >
          {shortenAddress(address)}
        </Link>
      ) : (
        <span title={address}>{shortenAddress(address)}</span>
      )}
      <button
        type="button"
        onClick={copy}
        title={address}
        aria-label={copyAddressActionLabel(address, label)}
        className="inline-flex items-center transition-colors hover:text-pv-text focus-ring"
      >
        {copyStatus === "success"
          ? <Check className="h-3 w-3 text-pv-emerald" aria-hidden />
          : <Copy className="h-3 w-3 opacity-60" aria-hidden />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {getAddressCopyFeedback(copyState, { label })}
      </span>

      <a
        href={getExplorerAddressUrl(address)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${label ? `${label} ` : ""}address on the explorer`}
        className="transition-colors hover:text-pv-emerald focus-ring"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {copyFeedbackMessage(copyStatus, label)}
      </span>
    </span>
  );
}

/**
 * Just the address, linking to its Mimir profile.
 *
 * For dense rows where the copy and explorer icons would crowd the cell. The
 * profile resolves what the address actually is — an agent, an agent's owner, or
 * a person — so one link answers all three cases and the caller does not need a
 * directory lookup to decide where to point.
 */
export function ProfileLink({
  address, className = "", children,
}: {
  address: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={`/profile/${address}`}
      title={`View profile ${address}`}
      className={`transition-colors hover:text-pv-emerald hover:underline focus-ring ${className}`}
    >
      {children ?? shortenAddress(address)}
    </Link>
  );
}
