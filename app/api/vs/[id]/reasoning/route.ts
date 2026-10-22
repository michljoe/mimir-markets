/**
 * GET /api/vs/[id]/reasoning — the public agent reasoning timeline for a claim.
 *
 * Free and public: the summary, position, confidence, uncertainty and evidence
 * references. The x402 premium tier sells the persona's full take
 * (/api/council/reasoning), not this feed.
 *
 * Withheld and tombstoned events are excluded by the query, so an event that
 * tripped the safety pass never reaches a reader — while remaining in the table
 * as the audit trail.
 *
 * Responses are capped and cursor-paginated: the default page is 50 events
 * (max 200), newest first. Pass `limit` to adjust the page size and the
 * opaque `nextCursor` from the previous response as `before` to walk
 * backwards through older events.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getReasoningFeed, getClaimById } from "@/lib/db";
import { apiError } from "@/lib/api/errors";
import { isReasoningStage, type EvidenceRef } from "@/lib/reasoning/schema";
import { REASONING_TRACKS } from "@/lib/research/categories";
import { AGENT_ID_PATTERN } from "@/lib/agents/registry";
import {
  decodeReasoningCursor,
  encodeReasoningCursor,
  type ReasoningCursor,
} from "@/lib/reasoning-cursor";

export const dynamic = "force-dynamic";

const MAX_FILTER_LENGTH = 128;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface FeedItem {
  eventId: string;
  agentId: string;
  track: string;
  stage: string;
  position: string;
  confidenceBps: number;
  summary: string;
  uncertainty: string;
  evidence: Array<{
    domain: string;
    url: string;
    capturedAt: number;
    contentHash: string;
    freshnessSeconds?: number;
    trustTier?: string;
  }>;
  model?: string;
  promptVersion?: number;
  /** True when this was published before the agent took a position with money. */
  beforeStake: boolean;
  createdAt: number;
}

export interface ReasoningFilters {
  track?: string;
  agentId?: string;
  stage?: string;
}

export type ReasoningFiltersParseResult =
  | { ok: true; filters: ReasoningFilters }
  | { ok: false; field: "track" | "agent" };

/**
 * Validate the `track`, `agent` and `stage` query parameters for the
 * reasoning feed. Returns the normalized filters or the offending field.
 */
export function parseReasoningFilters(searchParams: URLSearchParams): ReasoningFiltersParseResult {
  const trackParam = searchParams.get("track")?.trim();
  if (trackParam) {
    if (trackParam.length > MAX_FILTER_LENGTH || !REASONING_TRACKS.includes(trackParam)) {
      return { ok: false, field: "track" };
    }
  }

  const agentParam = searchParams.get("agent")?.trim();
  if (agentParam) {
    if (agentParam.length > MAX_FILTER_LENGTH || !AGENT_ID_PATTERN.test(agentParam)) {
      return { ok: false, field: "agent" };
    }
  }

  const stageParam = searchParams.get("stage")?.trim();
  const stage = stageParam && isReasoningStage(stageParam) ? stageParam : undefined;

  return {
    ok: true,
    filters: {
      track: trackParam || undefined,
      agentId: agentParam || undefined,
      stage,
    },
  };
}

export type { ReasoningCursor as ReasoningFeedCursor };
export { decodeReasoningCursor as decodeReasoningFeedCursor };
export { encodeReasoningCursor as encodeReasoningFeedCursor };

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseEvidence(json: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
}

function invalidRequest(field: string): NextResponse {
  return NextResponse.json(
    { error: "invalid_request", field },
    { status: 400 },
  );
}

/**
 * Standard 404 envelope for an unknown claim. Keeps the contract identical to
 * the rest of the vs API surface.
 */
function notFound(): NextResponse {
  const error = apiError("not_found", "Claim not found");
  return NextResponse.json(error.body, {
    status: error.status,
    headers: error.headers,
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId < 1) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;

  const parsed = parseReasoningFilters(searchParams);
  if (!parsed.ok) {
    return invalidRequest(parsed.field);
  }
  const { track, agentId, stage } = parsed.filters;

  const limit = parseLimit(searchParams.get("limit"));
  const beforeRaw = searchParams.get("before");
  const before = beforeRaw ? decodeReasoningCursor(beforeRaw) : null;
  if (beforeRaw && !before) {
    return NextResponse.json({ error: "invalid before cursor" }, { status: 400 });
  }

  try {
    // Unknown claims answer 404 rather than an empty 200, so a client can
    // distinguish "no such claim" from "claim with no reasoning yet".
    const claim = await getClaimById(claimId);
    if (!claim) {
      return notFound();
    }

    // Fetch one extra row to detect whether another page exists.
    const rows = await getReasoningFeed({
      claimId,
      track,
      agentId,
      stage,
      limit: limit + 1,
      before: before ?? undefined,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: FeedItem[] = pageRows.map((row) => ({
      eventId: row.event_id,
      agentId: row.agent_id,
      track: row.track,
      stage: row.stage,
      position: row.position,
      confidenceBps: row.confidence_bps,
      summary: row.summary,
      uncertainty: row.uncertainty,
      evidence: parseEvidence(row.evidence_refs_json).map((ref) => ({
        domain: ref.domain,
        url: ref.url,
        capturedAt: ref.capturedAt,
        contentHash: ref.contentHash,
        freshnessSeconds: ref.freshnessSeconds,
        trustTier: ref.trustTier,
      })),
      model: row.model ?? undefined,
      promptVersion: row.prompt_version ?? undefined,
      // Lets the UI separate "explained itself first" from "explained itself
      // after committing money" without the client knowing the stage taxonomy.
      beforeStake: row.stage === "preflight" || row.stage === "pre_stake",
      createdAt: row.created_at,
    }));

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeReasoningCursor({ createdAt: last.created_at, eventId: last.event_id })
        : null;

    return NextResponse.json(
      { claimId, count: items.length, items, nextCursor },
      {
        headers: {
          // The feed grows slowly and is polled by the detail page.
          "cache-control": "s-maxage=15, stale-while-revalidate=60",
        },
      },
    );
  } catch {
    // No Neon configured (or it is down) means no feed — not a broken page.
    // Do not echo the driver message: it can leak host / connection details.
    return NextResponse.json(
      {
        claimId,
        count: 0,
        items: [],
        nextCursor: null,
        error: "feed unavailable",
      },
      { status: 503 },
    );
  }
}