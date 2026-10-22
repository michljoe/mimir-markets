"use client";

/**
 * Share a market to X or Farcaster.
 *
 * Both platforms scrape the page for its OG image, which is the SVG card
 * /api/share/[id] already renders — so this only has to hand them the URL and a
 * line of text. Building a second card here would give us two designs to keep in
 * step, and the one that broke would be the one nobody looked at.
 *
 * Intent URLs rather than SDKs: no script to load, no consent surface, and the
 * user lands in their own composer where they can edit before posting.
 */

import { Check, Link2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { supportsNativeShare } from "@/lib/share-market";

function marketUrl(claimId: number): string {
  // The share target must be absolute for a scraper; on the server render there is
  // no window, so this component is client-only.
  return `${window.location.origin}/vs/${claimId}`;
}

/** Kept short: X counts the URL against the limit and truncation eats the ask. */
function shareText(question: string, creatorPosition?: string | null): string {
  const trimmed = question.length > 140 ? `${question.slice(0, 137)}…` : question;
  return creatorPosition
    ? `${trimmed}\n\nI'm backing: ${creatorPosition.slice(0, 60)}\n\nSettled on-chain in USDC by Mimir:`
    : `${trimmed}\n\nSettled on-chain in USDC by Mimir:`;
}

export function ShareMarket({
  claimId, question, creatorPosition,
}: {
  claimId: number;
  question: string;
  creatorPosition?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // navigator is absent during SSR, so probe after mount to avoid a hydration
  // mismatch. First client render stays in sync with the server.
  useEffect(() => {
    setCanNativeShare(supportsNativeShare(typeof navigator === "undefined" ? null : navigator));
  }, []);

  async function shareNative() {
    try {
      await navigator.share({
        title: question,
        text: shareText(question, creatorPosition),
        url: marketUrl(claimId),
      });
    } catch {
      // The user dismissed the sheet or the platform refused — the X, Farcaster
      // and copy buttons below stay available as fallback.
    }
  }

  function open(kind: "x" | "farcaster") {
    const url = marketUrl(claimId);
    const text = shareText(question, creatorPosition);
    const href = kind === "x"
      ? `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
      : `https://warpcast.com/~/compose?text=${encodeURIComponent(`${text}\n${url}`)}&embeds[]=${encodeURIComponent(url)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(marketUrl(claimId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const button = "flex items-center gap-1.5 border border-pv-ink/[0.14] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-pv-muted transition-colors hover:border-pv-emerald/45 hover:text-pv-text focus-ring";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canNativeShare ? (
        <button type="button" onClick={shareNative} className={button} aria-label="Share">
          <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
        </button>
      ) : (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-pv-muted">
          <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
        </span>
      )}
      <button type="button" onClick={() => open("x")} className={button} aria-label="Share on X">
        {/* Inline mark: an icon font or remote SVG for one glyph is not worth a request. */}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.5 2h6.6l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" />
        </svg>
        X
      </button>
      <button type="button" onClick={() => open("farcaster")} className={button} aria-label="Share on Farcaster">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M4 3h16v3h-2v12h1.5v3h-6v-3H15v-5.2c0-1.7-1.3-3-3-3s-3 1.3-3 3V18h1.5v3h-6v-3H6V6H4V3Z" />
        </svg>
        Farcaster
      </button>
      <button type="button" onClick={copy} className={button} aria-label="Copy link">
        {copied ? <Check className="h-3.5 w-3.5 text-pv-emerald" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Link"}
      </button>
      {/* The button label is pinned by aria-label, so a polite live region is what
          actually tells a screen reader the copy landed. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </div>
  );
}
