/**
 * GET /api/share/[id] — the social share card for a claim, as SVG.
 *
 * SVG rather than a rasterised image on purpose: it needs no font binaries or
 * headless renderer, it stays crisp at any platform's dimensions, and it is
 * cheap enough to serve from the edge on every scrape. X and Farcaster fetch it
 * through their own image proxies, which rasterise it.
 *
 * This route is PUBLIC and unauthenticated — an OG scraper holds no session and
 * no invite key. So a private claim renders a locked placeholder: see
 * lib/share-card.ts for why the content model is separate and tested.
 */

import { NextResponse, type NextRequest } from "next/server";
import { readClaimRaw, type ClaimData } from "@/lib/contract";
import { toCanonicalMode } from "@/lib/market-modes";
import { buildShareCard, isCardSize, type ShareCard, type ShareCardLocale, type ShareCardInput } from "@/lib/share-card";
import { capture } from "@/lib/analytics/server";
import { idempotencyKey } from "@/lib/analytics/events";

export const dynamic = "force-dynamic";

export interface ShareRouteDeps {
  readClaim?: (claimId: number) => Promise<ClaimData | null>;
  buildCard?: (input: ShareCardInput, size?: any) => ShareCard;
}

let claimLoaderOverride: ((claimId: number) => Promise<ClaimData | null>) | null = null;

/**
 * Test helper to stub the claim loader for GET /api/share/[id].
 */
export function setClaimLoaderForTesting(
  loader: ((claimId: number) => Promise<ClaimData | null>) | null,
): void {
  claimLoaderOverride = loader;
}

/** XML-escape every interpolated string: claim text is user input. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Naive wrap by character budget — enough for a two-line headline. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > perLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) return lines;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function renderSvg(card: ShareCard, claimId: number): string {
  const { width, height } = card.size;
  const bg = "#0B0D0E";
  const text = "#F2F4F3";
  const muted = "#8A9391";
  const accent = card.locked ? "#8A9391" : "#34D399";

  const titleLines = wrap(card.title, 34, 3);
  const titleY = 210;

  const footer = [card.modeLabel, card.economicsLabel, card.sourceDomain]
    .filter(Boolean)
    .join("  ·  ");
  const settled = [card.verdictLabel, card.payoutLabel].filter(Boolean).join("  ·  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(card.title)}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  <rect x="0" y="0" width="${width}" height="6" fill="${accent}"/>

  <text x="72" y="104" font-family="ui-monospace, monospace" font-size="22" letter-spacing="6" fill="${muted}">MIMIR</text>
  <text x="${width - 72}" y="104" text-anchor="end" font-family="ui-monospace, monospace" font-size="22" fill="${muted}">#${claimId}</text>

  ${titleLines
    .map(
      (line, i) =>
        `<text x="72" y="${titleY + i * 58}" font-family="system-ui, sans-serif" font-size="46" font-weight="700" fill="${text}">${esc(line)}</text>`,
    )
    .join("\n  ")}

  <g transform="translate(72, ${titleY + titleLines.length * 58 + 46})">
    <rect x="0" y="0" width="${(width - 176) / 2}" height="76" rx="12" fill="#141819" stroke="#1F2523"/>
    <circle cx="24" cy="38" r="22" fill="#202927" stroke="#34D399"/>
    <text x="24" y="45" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="${text}">${esc(card.avatarFallbackA)}</text>
    <text x="58" y="25" font-family="ui-monospace, monospace" font-size="13" fill="${muted}">${esc(card.actorA)}</text>
    <text x="58" y="56" font-family="system-ui, sans-serif" font-size="21" font-weight="600" fill="${text}">${esc(card.sideA)}</text>

    <g transform="translate(${(width - 176) / 2 + 32}, 0)">
      <rect x="0" y="0" width="${(width - 176) / 2}" height="76" rx="12" fill="#141819" stroke="#1F2523"/>
      <circle cx="24" cy="38" r="22" fill="#202927" stroke="#EC4899"/>
      <text x="24" y="45" text-anchor="middle" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="${text}">${esc(card.avatarFallbackB)}</text>
      <text x="58" y="25" font-family="ui-monospace, monospace" font-size="13" fill="${muted}">${esc(card.actorB)}</text>
      <text x="58" y="56" font-family="system-ui, sans-serif" font-size="21" font-weight="600" fill="${text}">${esc(card.sideB)}</text>
    </g>
  </g>

  ${card.potLabel ? `<text x="72" y="${height - 122}" font-family="ui-monospace, monospace" font-size="40" font-weight="700" fill="${accent}">${esc(card.potLabel)}</text>` : ""}
  ${card.seriesLabel ? `<text x="${width - 72}" y="${height - 122}" text-anchor="end" font-family="ui-monospace, monospace" font-size="24" fill="${text}">${esc(card.seriesLabel)}</text>` : ""}
  ${settled ? `<text x="72" y="${height - 78}" font-family="system-ui, sans-serif" font-size="26" font-weight="600" fill="${text}">${esc(settled)}</text>` : ""}
  ${footer ? `<text x="72" y="${height - 38}" font-family="ui-monospace, monospace" font-size="20" fill="${muted}">${esc(footer)}</text>` : ""}
</svg>`;
}

export async function GET(
  req: NextRequest | Request,
  ctx: { params: Promise<{ id: string }> | { id: string } },
  deps: ShareRouteDeps = {},
): Promise<NextResponse | Response> {
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId < 1) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }

  const searchParams =
    "nextUrl" in req ? req.nextUrl.searchParams : new URL(req.url).searchParams;
  const sizeParam = searchParams.get("size") ?? "og";
  const size = isCardSize(sizeParam) ? sizeParam : "og";
  const localeParam = searchParams.get("locale");
  const locale: ShareCardLocale = localeParam === "tr" ? "tr" : "en";

  const loader = deps.readClaim ?? claimLoaderOverride ?? readClaimRaw;
  const claim = await loader(claimId).catch(() => null);
  if (!claim) {
    return NextResponse.json({ error: `claim ${claimId} not found` }, { status: 404 });
  }

  const mode = toCanonicalMode({
    marketType: claim.market_type,
    oddsMode: claim.odds_mode,
    maxChallengers: claim.max_challengers,
  });

  const cardBuilder = deps.buildCard ?? buildShareCard;
  const card = cardBuilder(
    {
      claimId,
      question: claim.question,
      creatorPosition: claim.creator_position,
      counterPosition: claim.counter_position,
      resolutionUrl: claim.resolution_url,
      totalPot: claim.total_pot,
      mode,
      deadline: claim.deadline,
      state: claim.state,
      // The single guard that keeps a private claim off a public card.
      isPrivate: Boolean(claim.is_private || claim.visibility === "private"),
      winnerSide: claim.winner_side,
      locale,
      creatorIdentity: claim.creator,
      challengerIdentity: claim.first_challenger,
    },
    size,
  );

  // Awaited: the function freezes as soon as the response returns. The
  // idempotency key is per (claim, size, kind), so a scraper refetching the same
  // card does not inflate the count — the metric is "a card exists for this
  // market", and share_card_clicked measures actual traffic.
  await capture({
    event: "share_card_generated",
    envelope: {
      actor_type: "anonymous",
      source_surface: "share_card",
      claim_id: claimId,
      // Mode is not secret — the locked card shows it too — so a private claim's
      // card still reports which product generated it.
      subject_type: mode.subjectType,
      settlement_mode: mode.settlementMode,
    },
    properties: { card_kind: card.kind, card_size: size, locked: card.locked },
    idempotencyKey: idempotencyKey(["share_card_generated", claimId, size, card.kind]),
    consented: true,
  });

  return new Response(renderSvg(card, claimId), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // A settled card never changes; an open one changes as the pot moves.
      "cache-control":
        claim.state === "resolved" || claim.state === "cancelled"
          ? "public, s-maxage=86400, stale-while-revalidate=604800"
          : "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
