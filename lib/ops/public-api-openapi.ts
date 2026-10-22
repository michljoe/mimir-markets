/**
 * The published public read API contract, generated from the live code.
 *
 * Mimir's public read routes are consumed by external integrators, dashboards,
 * and monitoring tools without reading the repository. Rather than maintaining
 * a hand-written spec that drifts when a query parameter, cache header, error
 * code, or response field changes, this module derives `docs/openapi-public-v1.yaml`
 * directly from the shared constants, validators, freshness helpers, and error
 * catalogue that the routes themselves use:
 *
 *   error catalogue    lib/api/errors.ts                  (apiError, apiErrorCatalogue, statusFor, isRetryable)
 *   rate-limit policy  lib/api/policy.ts                  (TIER_POLICIES.public_read)
 *   rate-limit rules   lib/api/rate-limit.ts              (DEFAULT_RULES)
 *   VS cache headers   lib/server/vs-cache.ts             (VS_CACHE_HEADERS, VS_REVALIDATE_SECONDS)
 *   freshness model    lib/vs-freshness.ts                (buildVSCacheFreshness, makeContractFreshness)
 *   address & invite   lib/server/api-validation.ts       (INVITE_KEY_PATTERN, parseAddressParam, parseInviteKey)
 *   categories         lib/claimDrafts.ts                 (CLAIM_DRAFT_CATEGORY_IDS, CLAIM_DRAFT_SOURCE_TYPES)
 *   reasoning schema   lib/reasoning/schema.ts            (REASONING_STAGES, REASONING_POSITIONS, MAX_SUMMARY_CHARS, MAX_UNCERTAINTY_CHARS, MAX_EVIDENCE_REFS)
 *   performance series lib/agents/performance.ts          (computeAgentPerformance, cumulativePnlPoints)
 *                      lib/portfolio-performance.ts       (isPortfolioPerformanceResponse)
 *   baskets            lib/baskets.ts                     (DEFAULT_BASKET_POLICY)
 *   health evaluator   lib/ops/health.ts                  (DEFAULT_THRESHOLDS, MIN_SAMPLES, MONITORED_WORKERS, evaluateHealth, healthHttpStatus)
 *
 * Every published response example is generated from the live builders and
 * validated against its component JSON schema via `lib/ops/json-schema-subset.ts`
 * before the document can pass `auditPublicApiDocument`.
 *
 * Two rules make the result safe to commit:
 *
 *   1. **No secrets, ever.** Every wallet address in examples is one of the
 *      synthetic placeholders from `SYNTHETIC_WALLETS`, and the secret/wallet
 *      scanner rejects anything else.
 *   2. **Offline and deterministic.** No env, no wall clock, no randomness, no
 *      database or RPC: the same commit always regenerates the exact same bytes.
 */

import {
  computeAgentPerformance,
  cumulativePnlPoints,
  type AgentTradeRow,
} from "@/lib/agents/performance";
import {
  apiError,
  apiErrorCatalogue,
  isRetryable,
  statusFor,
  type ApiErrorCode,
} from "@/lib/api/errors";
import { TIER_POLICIES } from "@/lib/api/policy";
import { DEFAULT_RULES } from "@/lib/api/rate-limit";
import { DEFAULT_BASKET_POLICY } from "@/lib/baskets";
import { getSeedChallengeOpportunities } from "@/lib/challengeOpportunitySeeds";
import {
  CLAIM_DRAFT_CATEGORY_IDS,
  CLAIM_DRAFT_SOURCE_TYPES,
  type ChallengeOpportunitiesResponse,
} from "@/lib/claimDrafts";
import { computeClaimQuality } from "@/lib/claimQuality";
import { ZERO_ADDRESS } from "@/lib/constants";
import { mapClaimToVS, type ClaimData, type VSData } from "@/lib/contract";
import type { StoredBasket } from "@/lib/db";
import {
  EXAMPLE_SIGNED_AT_MS,
  SERVER_URL_PLACEHOLDER,
  SYNTHETIC_WALLETS,
  SYNTHETIC_WALLET_VALUES,
  auditPublishedText,
  auditSyntheticWallets,
  unallowedSecretIn,
  type RenderedArtifact,
} from "@/lib/ops/agent-api-openapi";
import {
  DEFAULT_THRESHOLDS,
  MIN_SAMPLES,
  MONITORED_WORKERS,
  evaluateHealth,
  healthHttpStatus,
  type HealthSnapshot,
} from "@/lib/ops/health";
import {
  assertSupportedKeywords,
  validateAgainstSchema,
} from "@/lib/ops/json-schema-subset";
import { asYamlValue, toYaml, type YamlValue } from "@/lib/ops/yaml";
import {
   isPortfolioPerformanceResponse,
  type PortfolioPerformanceResponse,
} from "@/lib/portfolio-performance";
import {
  MAX_EVIDENCE_REFS,
  MAX_SUMMARY_CHARS,
  MAX_UNCERTAINTY_CHARS,
  REASONING_POSITIONS,
  REASONING_STAGES,
  reasoningEventId,
} from "@/lib/reasoning/schema";
import {
  INVITE_KEY_PATTERN,
  parseAddressParam,
  parseInviteKey,
  parsePositiveIntegerParam,
} from "@/lib/server/api-validation";
import { VS_CACHE_HEADERS, VS_REVALIDATE_SECONDS } from "@/lib/server/vs-cache";
import {
  type VSCacheFreshness,
  type VSCacheFreshnessSource,
  type VSCacheFreshnessStatus,
} from "@/lib/vs-freshness";

export const PUBLIC_OPENAPI_RELATIVE = "docs/openapi-public-v1.yaml";
export const PUBLIC_API_VERSION = "v1";

/** Fixed ISO timestamp matching `EXAMPLE_SIGNED_AT_MS` for deterministic examples. */
export const EXAMPLE_ISO_TIMESTAMP = new Date(EXAMPLE_SIGNED_AT_MS).toISOString();

/** Fixed unix seconds matching `EXAMPLE_SIGNED_AT_MS`. */
const EXAMPLE_TIMESTAMP_S = Math.floor(EXAMPLE_SIGNED_AT_MS / 1000);

/**
 * Every public read endpoint documented in `docs/openapi-public-v1.yaml`.
 */
export const PUBLIC_READ_PATHS = [
  "/api/vs",
  "/api/vs/{id}",
  "/api/vs/{id}/reasoning",
  "/api/vs/user/{address}",
  "/api/challenge-opportunities",
  "/api/performance/{address}",
  "/api/baskets",
  "/api/health",
] as const;

export type PublicReadPath = (typeof PUBLIC_READ_PATHS)[number];

export interface PublicEndpointMetadata {
  path: PublicReadPath;
  operationId: string;
  summary: string;
  cacheControl: string;
  rateLimited: boolean;
  rateLimitRouteKey?: string;
  featureFlagEnv?: string;
  responseSchemaName: string;
  statuses: readonly number[];
}

export const PUBLIC_ENDPOINT_METADATA: Record<PublicReadPath, PublicEndpointMetadata> = {
  "/api/vs": {
    path: "/api/vs",
    operationId: "listVsFeed",
    summary: "List public VS claims from the read index with cursor pagination.",
    cacheControl: VS_CACHE_HEADERS["Cache-Control"],
    rateLimited: true,
    rateLimitRouteKey: "/api/vs",
    responseSchemaName: "VSFeedResponse",
    statuses: [200, 400, 429, 500],
  },
  "/api/vs/{id}": {
    path: "/api/vs/{id}",
    operationId: "getVsById",
    summary: "Fetch a single VS claim by ID, or unlock a private claim with an invite key.",
    cacheControl: `${VS_CACHE_HEADERS["Cache-Control"]} (public) | private, no-store (with ?invite)`,
    rateLimited: true,
    rateLimitRouteKey: "/api/vs/[id]?invite",
    responseSchemaName: "VSDetailResponse",
    statuses: [200, 400, 404, 429, 500],
  },
  "/api/vs/{id}/reasoning": {
    path: "/api/vs/{id}/reasoning",
    operationId: "getVsReasoningTimeline",
    summary: "List the public agent reasoning timeline for a claim.",
    cacheControl: "s-maxage=15, stale-while-revalidate=60",
    rateLimited: false,
    responseSchemaName: "ReasoningFeedResponse",
    statuses: [200, 400, 503],
  },
  "/api/vs/user/{address}": {
    path: "/api/vs/user/{address}",
    operationId: "listUserVs",
    summary: "List public VS claims where the Stellar address is creator or challenger.",
    cacheControl: VS_CACHE_HEADERS["Cache-Control"],
    rateLimited: false,
    responseSchemaName: "VSUserFeedResponse",
    statuses: [200, 400, 500],
  },
  "/api/challenge-opportunities": {
    path: "/api/challenge-opportunities",
    operationId: "listChallengeOpportunities",
    summary: "List source-backed challenge and claim creation opportunities.",
    cacheControl: "s-maxage=600, stale-while-revalidate=300",
    rateLimited: false,
    featureFlagEnv: "NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS",
    responseSchemaName: "ChallengeOpportunitiesResponse",
    statuses: [200, 400, 404, 500, 503],
  },
  "/api/performance/{address}": {
    path: "/api/performance/{address}",
    operationId: "getPortfolioPerformance",
    summary: "Cumulative realised P&L series and settled count for a Stellar address.",
    cacheControl: "no-store",
    rateLimited: false,
    responseSchemaName: "PortfolioPerformanceResponse",
    statuses: [200, 400, 503],
  },
  "/api/baskets": {
    path: "/api/baskets",
    operationId: "listBaskets",
    summary: "List user-composed agent baskets with active subscriber counts.",
    cacheControl: "no-store",
    rateLimited: true,
    rateLimitRouteKey: "/api/baskets",
    responseSchemaName: "BasketsListResponse",
    statuses: [200, 429],
  },
  "/api/health": {
    path: "/api/health",
    operationId: "getHealthProbe",
    summary: "Operational health probe reporting worker heartbeats, sync age, backlog, and alarms.",
    cacheControl: "no-store",
    rateLimited: false,
    responseSchemaName: "HealthProbeResponse",
    statuses: [200, 503],
  },
};

export type PublicOpenApiFindingCode =
  | "DOC_INVALID_OPENAPI_VERSION"
  | "DOC_MISSING_PATH"
  | "DOC_UNKNOWN_PATH"
  | "DOC_MISSING_OPERATION"
  | "DOC_MISSING_SCHEMA"
  | "DOC_SCHEMA_UNSUPPORTED"
  | "DOC_MISSING_RESPONSE"
  | "DOC_CACHE_HEADER_DRIFT"
  | "DOC_RATE_LIMIT_DRIFT"
  | "DOC_PARAMETER_DRIFT"
  | "ERROR_STATUS_DRIFT"
  | "ERROR_RETRYABLE_DRIFT"
  | "EXAMPLE_MISSING"
  | "EXAMPLE_SCHEMA_REJECTED"
  | "EXAMPLE_VALIDATION_DRIFT"
  | "SERVER_URL_NOT_PLACEHOLDER"
  | "SECRET_MATERIAL_IN_DOCS"
  | "PLACEHOLDER_WALLET_UNKNOWN"
  | "PLACEHOLDER_WALLET_MALFORMED"
  | "ARTIFACT_MISSING"
  | "ARTIFACT_DRIFT";

export interface PublicOpenApiFinding {
  code: PublicOpenApiFindingCode;
  severity: "error" | "warning";
  where: string;
  message: string;
}

export interface PublicOpenApiAudit {
  ok: boolean;
  findings: PublicOpenApiFinding[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finding(
  code: PublicOpenApiFindingCode,
  severity: PublicOpenApiFinding["severity"],
  where: string,
  message: string,
): PublicOpenApiFinding {
  return { code, severity, where, message };
}

// ── Shared JSON Schemas (subset-validator compatible, no $ref) ────────────────

const STELLAR_ADDRESS_PATTERN = "^[GC][A-Z2-7]{55}$";
const INVITE_KEY_REGEX_SOURCE = INVITE_KEY_PATTERN.source;
const CLAIM_STATES = ["open", "accepted", "resolved", "cancelled"] as const;
const WINNER_SIDES = ["creator", "challengers", "draw", "unresolvable", ""] as const;
const VISIBILITIES = ["public", "private"] as const;
const FRESHNESS_SOURCES: readonly VSCacheFreshnessSource[] = ["index", "contract"];
const FRESHNESS_STATUSES: readonly VSCacheFreshnessStatus[] = ["live", "cached", "stale"];
const REASONING_TRACKS = ["classic", "philosopher", "oracle", "external"] as const;
const EVIDENCE_TRUST_TIERS = ["primary", "corroborating", "unverified"] as const;
const OPPORTUNITY_STRENGTH_TIERS = ["strong", "good", "fair", "weak"] as const;
const OPPORTUNITY_ACTIONS = ["create", "challenge"] as const;
const HEALTH_SEVERITIES = ["ok", "warn", "critical"] as const;
const ALARM_UNITS = ["seconds", "blocks", "count", "ratio"] as const;

/**
 * Component schemas for every public read endpoint.
 *
 * Every schema is self-contained (inlined subschemas rather than `$ref`) so that
 * `lib/ops/json-schema-subset.ts` (`assertSupportedKeywords` + `validateAgainstSchema`)
 * can validate every schema and every example directly without ignoring `$ref`.
 */
export function buildPublicApiSchemas(): Record<string, Record<string, unknown>> {
  const VSCacheFreshness: Record<string, unknown> = {
    type: "object",
    description: "Read-index or direct-contract freshness metadata (`lib/vs-freshness.ts`).",
    required: ["source", "status", "lastUpdatedAt", "ageMs", "freshnessWindowMs"],
    additionalProperties: false,
    properties: {
      source: {
        type: "string",
        enum: [...FRESHNESS_SOURCES],
        description: "`index` when served from the Postgres/file read cache; `contract` when read directly from Soroban.",
      },
      status: {
        type: "string",
        enum: [...FRESHNESS_STATUSES],
        description: "`live` within freshnessWindowMs, `cached` within 5x window, `stale` beyond.",
      },
      lastUpdatedAt: {
        type: ["string", "null"],
        description: "ISO-8601 timestamp of the last sync, or null if the index has not synced.",
      },
      ageMs: {
        type: ["integer", "null"],
        minimum: 0,
        description: "Milliseconds since `lastUpdatedAt`, or null when unknown.",
      },
      freshnessWindowMs: {
        type: "integer",
        minimum: 1,
        description: "Target freshness window in milliseconds (60000 for feeds, 15000 for detail, 1 for direct contract reads).",
      },
    },
  };

  const ClaimChallenger: Record<string, unknown> = {
    type: "object",
    description: "A challenger entry on a claim (`lib/contract.ts::ClaimChallenger`).",
    required: ["address", "stake", "potential_payout"],
    additionalProperties: false,
    properties: {
      address: {
        type: "string",
        pattern: STELLAR_ADDRESS_PATTERN,
        description: "Challenger Stellar `G…` or `C…` strkey.",
      },
      stake: {
        type: "number",
        minimum: 0,
        description: "Committed stake in display USDC.",
      },
      potential_payout: {
        type: "number",
        minimum: 0,
        description: "Projected gross payout in display USDC if challengers win.",
      },
      claimed: {
        type: "boolean",
        description: "True once the challenger has pulled their settlement on chain.",
      },
    },
  };

  const VSDataSchema: Record<string, unknown> = {
    type: "object",
    description: "Public market / claim representation (`lib/contract.ts::VSData`).",
    required: [
      "id",
      "creator",
      "opponent",
      "question",
      "creator_position",
      "opponent_position",
      "resolution_url",
      "stake_amount",
      "deadline",
      "state",
      "winner",
      "resolution_summary",
      "category",
    ],
    additionalProperties: false,
    properties: {
      id: { type: "integer", minimum: 1, description: "On-chain claim ID (dense 1-indexed integer)." },
      creator: { type: "string", pattern: STELLAR_ADDRESS_PATTERN, description: "Creator Stellar strkey (`G…` or `C…`)." },
      opponent: { type: "string", description: "First challenger strkey, or the zero-address sentinel when unchallenged." },
      question: { type: "string", description: "Market question (redacted to empty string on private claims without invite key)." },
      creator_position: { type: "string", description: "Side A position statement." },
      opponent_position: { type: "string", description: "Side B counter-position statement." },
      counter_position: { type: "string", description: "Canonical counter-position field from `ClaimData`." },
      resolution_url: { type: "string", description: "Primary resolution source URL." },
      stake_amount: { type: "number", minimum: 0, description: "Creator stake in display USDC." },
      creator_stake: { type: "number", minimum: 0, description: "Creator stake in display USDC." },
      total_challenger_stake: { type: "number", minimum: 0, description: "Sum of challenger stakes in display USDC." },
      reserved_creator_liability: { type: "number", minimum: 0, description: "Creator stake locked against fixed-odds challengers." },
      available_creator_liability: { type: "number", minimum: 0, description: "Remaining creator stake open to fixed-odds challenges." },
      deadline: { type: "integer", minimum: 0, description: "Unix timestamp in seconds when staking closes." },
      state: { type: "string", enum: [...CLAIM_STATES], description: "Lifecycle state (`active` on chain maps to `accepted` in `VSData`)." },
      winner: { type: "string", description: "Winning address or zero-address sentinel when unresolved / multi-challenger." },
      winner_side: { type: "string", enum: [...WINNER_SIDES], description: "Resolved winning side." },
      resolution_summary: { type: "string", description: "Oracle settlement summary." },
      confidence: { type: "integer", minimum: 0, maximum: 100, description: "Oracle confidence score (0-100)." },
      created_at: { type: "integer", minimum: 0, description: "Creation timestamp in unix seconds." },
      category: { type: "string", enum: [...CLAIM_DRAFT_CATEGORY_IDS], description: "Normalized market category." },
      parent_id: { type: "integer", minimum: 0, description: "Parent claim ID for rematches, or 0." },
      challenger_count: { type: "integer", minimum: 0, description: "Number of challengers." },
      market_type: { type: "string", description: "Market structure (e.g. `binary`)." },
      odds_mode: { type: "string", description: "Odds mode (`pool` or `fixed`)." },
      challenger_payout_bps: { type: "integer", minimum: 0, description: "Fixed-odds payout multiplier in basis points." },
      handicap_line: { type: "string", description: "Optional handicap line." },
      settlement_rule: { type: "string", description: "Explicit settlement rule evaluated by the oracle." },
      max_challengers: { type: "integer", minimum: 0, description: "Maximum challenger count (0 = unlimited pool)." },
      visibility: { type: "string", enum: [...VISIBILITIES], description: "`public` or `private`." },
      is_private: { type: "boolean", description: "True when the claim requires an invite key to view content." },
      challengers: { type: "array", items: ClaimChallenger, description: "Challenger roster when hydrated." },
      first_challenger: { type: "string", description: "First challenger address or empty/zero sentinel." },
      challenger_addresses: { type: "array", items: { type: "string" }, description: "Participating challenger addresses." },
      total_pot: { type: "number", minimum: 0, description: "Total staked pot in display USDC." },
      remaining_escrow: { type: "number", minimum: 0, description: "Unclaimed escrow remaining in display USDC." },
      challenger_claims: { type: "integer", minimum: 0, description: "Number of challengers who have pulled payouts." },
      evidence_hash: { type: "string", description: "32-byte hex hash of oracle settlement evidence." },
      context_hash: { type: "string", description: "32-byte hex hash of creation research context." },
      creator_requested_resolve: { type: "boolean" },
      challenger_requested_resolve: { type: "boolean" },
      resolve_attempts: { type: "integer", minimum: 0 },
    },
  };

  const ApiErrorSchema: Record<string, unknown> = {
    type: "object",
    description: "Structured error envelope from `lib/api/errors.ts`.",
    required: ["error"],
    additionalProperties: false,
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "retryable"],
        additionalProperties: false,
        properties: {
          code: {
            type: "string",
            enum: apiErrorCatalogue().map((spec) => spec.code),
            description: "Stable machine error code.",
          },
          message: {
            type: "string",
            description: "Human-readable error detail.",
          },
          retryable: {
            type: "boolean",
            description: "Whether repeating the request after waiting or fixing freshness can succeed.",
          },
          retryAfterSeconds: {
            type: "number",
            minimum: 0,
            description: "Suggested backoff in seconds when retryable.",
          },
          field: {
            type: "string",
            description: "Request parameter or field that failed validation.",
          },
          requestId: {
            type: "string",
            description: "Optional caller correlation ID.",
          },
          trace_id: {
            type: "string",
            description: "Ambient server trace ID when executed inside a traced route.",
          },
        },
      },
    },
  };

  const ReasoningInvalidClaimError: Record<string, unknown> = {
    type: "object",
    description: "400 validation error returned by `/api/vs/{id}/reasoning` when `{id}` is not a positive integer.",
    required: ["error"],
    additionalProperties: false,
    properties: {
      error: {
        type: "string",
        const: "invalid claim id",
      },
    },
  };

  const ReasoningEvidenceRef: Record<string, unknown> = {
    type: "object",
    description: "Captured source reference backing a reasoning event (`lib/reasoning/schema.ts::EvidenceRef`).",
    required: ["domain", "url", "capturedAt", "contentHash"],
    additionalProperties: false,
    properties: {
      domain: { type: "string", minLength: 1, description: "Registrable domain of the source URL." },
      url: { type: "string", pattern: "^https?://", description: "HTTP(S) URL fetched by the agent." },
      capturedAt: { type: "integer", minimum: 1, description: "Epoch milliseconds when the source was captured." },
      contentHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "32-byte hash of the captured content." },
      freshnessSeconds: { type: "integer", minimum: 0, description: "Age of the source at capture time in seconds." },
      trustTier: { type: "string", enum: [...EVIDENCE_TRUST_TIERS], description: "Source provenance tier." },
    },
  };

  const ReasoningFeedItem: Record<string, unknown> = {
    type: "object",
    description: "Public reasoning timeline item (`app/api/vs/[id]/reasoning/route.ts::FeedItem`).",
    required: [
      "eventId",
      "agentId",
      "track",
      "stage",
      "position",
      "confidenceBps",
      "summary",
      "uncertainty",
      "evidence",
      "beforeStake",
      "createdAt",
    ],
    additionalProperties: false,
    properties: {
      eventId: { type: "string", minLength: 1, description: "Deterministic event ID (`claimId:agentId:stage:sequence`)." },
      agentId: { type: "string", minLength: 1, description: "Agent registry identifier (never a raw wallet strkey)." },
      track: { type: "string", enum: [...REASONING_TRACKS], description: "Jury or agent track." },
      stage: { type: "string", enum: [...REASONING_STAGES], description: "Lifecycle stage when reasoning was published." },
      position: { type: "string", enum: [...REASONING_POSITIONS], description: "Stated position on the claim." },
      confidenceBps: {
        type: "integer",
        minimum: 0,
        maximum: 10_000,
        description: "Confidence in basis points (0..10000).",
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: MAX_SUMMARY_CHARS,
        description: "Public rationale summary (never hidden chain-of-thought).",
      },
      uncertainty: {
        type: "string",
        minLength: 1,
        maxLength: MAX_UNCERTAINTY_CHARS,
        description: "What the agent could not determine.",
      },
      evidence: {
        type: "array",
        items: ReasoningEvidenceRef,
        description: `Supporting evidence references (up to ${MAX_EVIDENCE_REFS}).`,
      },
      model: { type: "string", description: "Model identifier when disclosed." },
      promptVersion: { type: "integer", minimum: 1, description: "Rubric prompt version." },
      beforeStake: {
        type: "boolean",
        description: "True when `stage` is `preflight` or `pre_stake`.",
      },
      createdAt: { type: "integer", minimum: 0, description: "Epoch milliseconds when recorded." },
    },
  };

  const ReasoningFeedResponse: Record<string, unknown> = {
    type: "object",
    description: "Public reasoning timeline response for `/api/vs/{id}/reasoning`.",
    required: ["claimId", "count", "items"],
    additionalProperties: false,
    properties: {
      claimId: { type: "integer", minimum: 1 },
      count: { type: "integer", minimum: 0 },
      items: { type: "array", items: ReasoningFeedItem },
      error: {
        type: "string",
        description: "Present on 503 degraded responses when the database is unavailable.",
      },
    },
  };

  const SourceClaimDraftCandidateSchema: Record<string, unknown> = {
    type: "object",
    description: "Structured claim draft candidate derived from a source URL (`lib/claimDrafts.ts::SourceClaimDraftCandidate`).",
    required: [
      "category",
      "claimText",
      "sideA",
      "sideB",
      "deadlineAt",
      "timezone",
      "primaryResolutionSource",
      "settlementRule",
      "ambiguityFlags",
      "confidenceScore",
    ],
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: [...CLAIM_DRAFT_CATEGORY_IDS] },
      claimText: { type: "string", minLength: 1 },
      sideA: { type: "string", minLength: 1 },
      sideB: { type: "string", minLength: 1 },
      deadlineAt: { type: "string", minLength: 1, description: "ISO-8601 deadline timestamp." },
      timezone: { type: "string", minLength: 1 },
      primaryResolutionSource: { type: "string", pattern: "^https?://" },
      settlementRule: { type: "string", minLength: 1 },
      ambiguityFlags: { type: "array", items: { type: "string" } },
      confidenceScore: { type: "integer", minimum: 0, maximum: 100 },
    },
  };

  const ChallengeOpportunitySchema: Record<string, unknown> = {
    type: "object",
    description: "A challenge or market creation opportunity (`lib/claimDrafts.ts::ChallengeOpportunity`).",
    required: [
      "id",
      "sourceUrl",
      "sourceType",
      "sourceSummary",
      "candidate",
      "claimStrengthScore",
      "claimStrengthTier",
      "action",
    ],
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1 },
      sourceUrl: { type: "string", pattern: "^https?://" },
      sourceType: { type: "string", enum: [...CLAIM_DRAFT_SOURCE_TYPES] },
      sourceSummary: { type: "string", minLength: 1 },
      candidate: SourceClaimDraftCandidateSchema,
      claimStrengthScore: { type: "integer", minimum: 0, maximum: 100 },
      claimStrengthTier: { type: "string", enum: [...OPPORTUNITY_STRENGTH_TIERS] },
      action: { type: "string", enum: [...OPPORTUNITY_ACTIONS] },
      existingClaimId: { type: "integer", minimum: 1 },
    },
  };

  const ChallengeOpportunitiesResponseSchema: Record<string, unknown> = {
    type: "object",
    description: "Response payload for `GET /api/challenge-opportunities` (`lib/claimDrafts.ts::ChallengeOpportunitiesResponse`).",
    required: ["items", "count", "generatedAt"],
    additionalProperties: false,
    properties: {
      items: { type: "array", items: ChallengeOpportunitySchema },
      count: { type: "integer", minimum: 0 },
      generatedAt: { type: "string", description: "ISO-8601 generation timestamp, or empty string when no rows exist." },
    },
  };

  const PnlPointSchema: Record<string, unknown> = {
    type: "object",
    description: "A cumulative realised P&L point (`lib/agents/performance.ts::PnlPoint`).",
    required: ["timestamp", "value"],
    additionalProperties: false,
    properties: {
      timestamp: { type: "integer", minimum: 1, description: "Settlement timestamp in epoch milliseconds." },
      value: { type: "number", description: "Cumulative realised P&L in display USDC." },
    },
  };

  const PortfolioPerformanceResponseSchema: Record<string, unknown> = {
    type: "object",
    description: "Response payload for `GET /api/performance/{address}` (`lib/portfolio-performance.ts::PortfolioPerformanceResponse`).",
    required: ["points", "settled", "cache"],
    additionalProperties: false,
    properties: {
      points: { type: "array", items: PnlPointSchema },
      settled: { type: "integer", minimum: 0, description: "Total number of settled markets for this address." },
      cache: VSCacheFreshness,
    },
  };

  const StoredBasketSchema: Record<string, unknown> = {
    type: "object",
    description: "A user-composed agent basket (`lib/db.ts::StoredBasket`).",
    required: ["basketId", "creatorWallet", "name", "thesis", "membersJson", "createdAt"],
    additionalProperties: false,
    properties: {
      basketId: { type: "string", minLength: 1, description: "Slugified basket ID with random suffix." },
      creatorWallet: { type: "string", pattern: STELLAR_ADDRESS_PATTERN, description: "Creator Stellar `G…` account strkey." },
      name: { type: "string", minLength: 1, maxLength: 60 },
      thesis: { type: "string", maxLength: 300 },
      membersJson: { type: "string", description: "JSON-serialized array of `{ agentId, weightBps }` members totaling 10000 bps." },
      createdAt: { type: "integer", minimum: 0, description: "Creation timestamp in epoch milliseconds." },
      subscriberCount: { type: "integer", minimum: 0, description: "Active (non-revoked) subscriber count." },
    },
  };

  const BasketsListResponseSchema: Record<string, unknown> = {
    type: "object",
    description: "Response payload for `GET /api/baskets`.",
    required: ["baskets"],
    additionalProperties: false,
    properties: {
      baskets: { type: "array", items: StoredBasketSchema },
    },
  };

  const HealthAlarmSchema: Record<string, unknown> = {
    type: "object",
    description: "An operational health alarm (`lib/ops/health.ts::Alarm`, plus the unconfigured-DB sentinel alarm).",
    required: ["id", "severity", "message"],
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1, description: "Stable alarm identifier (e.g. `db.unconfigured`, `index.stale`)." },
      severity: { type: "string", enum: [...HEALTH_SEVERITIES] },
      message: { type: "string", minLength: 1 },
      observed: { type: "number" },
      threshold: { type: "number" },
      unit: { type: "string", enum: [...ALARM_UNITS] },
    },
  };

  const HealthMeasurementsSchema: Record<string, unknown> = {
    type: "object",
    description: "Raw health measurements (`lib/ops/health.ts::HealthReport['measurements']`).",
    required: [
      "indexLastSyncAgeSec",
      "oldestQueuedJobAgeSec",
      "oldestOverdueSettlementSec",
      "oracleBacklog",
      "rpcFailureRatio",
      "facilitatorFailureRatio",
      "sourceFailureRatio",
      "workerAgesSec",
      "workerTraceIds",
      "agentBalancesUsdc",
    ],
    additionalProperties: false,
    properties: {
      indexLastSyncAgeSec: { type: ["integer", "null"], minimum: 0 },
      oldestQueuedJobAgeSec: { type: "integer", minimum: 0 },
      oldestOverdueSettlementSec: { type: "integer", minimum: 0 },
      oracleBacklog: { type: "integer", minimum: 0 },
      rpcFailureRatio: { type: "number", minimum: 0, maximum: 1 },
      facilitatorFailureRatio: { type: "number", minimum: 0, maximum: 1 },
      sourceFailureRatio: { type: "number", minimum: 0, maximum: 1 },
      workerAgesSec: {
        type: "object",
        additionalProperties: { type: ["integer", "null"], minimum: 0 },
      },
      workerTraceIds: {
        type: "object",
        additionalProperties: { type: ["string", "null"] },
      },
      agentBalancesUsdc: {
        type: "object",
        additionalProperties: { type: ["number", "null"] },
      },
    },
  };

  const HealthProbeResponseSchema: Record<string, unknown> = {
    type: "object",
    description: "Response payload for `GET /api/health` (`app/api/health/route.ts`).",
    required: ["status", "alarms", "operationalStatusUrl"],
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: [...HEALTH_SEVERITIES] },
      alarms: { type: "array", items: HealthAlarmSchema },
      measurements: HealthMeasurementsSchema,
      operationalStatusUrl: { type: "string", const: "/api/health/status" },
    },
  };

  return {
    ApiError: ApiErrorSchema,
    ReasoningInvalidClaimError,
    VSCacheFreshness,
    ClaimChallenger,
    VSData: VSDataSchema,
    VSFeedResponse: {
      type: "object",
      description: "Response payload for `GET /api/vs`.",
      required: ["items", "count", "cache"],
      additionalProperties: false,
      properties: {
        items: { type: "array", items: VSDataSchema },
        count: { type: "integer", minimum: 0 },
        cache: VSCacheFreshness,
        nextCursor: {
          type: ["integer", "null"],
          minimum: 1,
          description: "Cursor ID for the next page, or null when no further pages exist.",
        },
      },
    },
    VSDetailResponse: {
      type: "object",
      description: "Response payload for `GET /api/vs/{id}`.",
      required: ["item", "cache"],
      additionalProperties: false,
      properties: {
        item: VSDataSchema,
        cache: VSCacheFreshness,
      },
    },
    VSUserFeedResponse: {
      type: "object",
      description: "Response payload for `GET /api/vs/user/{address}`.",
      required: ["items", "count", "cache"],
      additionalProperties: false,
      properties: {
        items: { type: "array", items: VSDataSchema },
        count: { type: "integer", minimum: 0 },
        cache: VSCacheFreshness,
      },
    },
    ReasoningEvidenceRef,
    ReasoningFeedItem,
    ReasoningFeedResponse,
    SourceClaimDraftCandidate: SourceClaimDraftCandidateSchema,
    ChallengeOpportunity: ChallengeOpportunitySchema,
    ChallengeOpportunitiesResponse: ChallengeOpportunitiesResponseSchema,
    PnlPoint: PnlPointSchema,
    PortfolioPerformanceResponse: PortfolioPerformanceResponseSchema,
    StoredBasket: StoredBasketSchema,
    BasketsListResponse: BasketsListResponseSchema,
    HealthAlarm: HealthAlarmSchema,
    HealthMeasurements: HealthMeasurementsSchema,
    HealthProbeResponse: HealthProbeResponseSchema,
  };
}

// ── Live-derived examples ─────────────────────────────────────────────────────

function exampleFreshness(source: VSCacheFreshnessSource, windowMs: number): VSCacheFreshness {
  return {
    source,
    status: "live",
    lastUpdatedAt: EXAMPLE_ISO_TIMESTAMP,
    ageMs: 0,
    freshnessWindowMs: windowMs,
  };
}

function exampleClaimData(): ClaimData {
  return {
    id: 42,
    creator: SYNTHETIC_WALLETS.owner,
    question: "Will BTC trade above $100,000 before April 30, 2026?",
    creator_position: "BTC trades above $100,000 before April 30, 2026",
    counter_position: "BTC stays at or below $100,000 through April 30, 2026",
    resolution_url: "https://coinmarketcap.com/currencies/bitcoin/",
    creator_stake: 25,
    total_challenger_stake: 25,
    reserved_creator_liability: 25,
    available_creator_liability: 0,
    deadline: EXAMPLE_TIMESTAMP_S + 86_400,
    state: "active",
    winner_side: "",
    resolution_summary: "",
    confidence: 0,
    category: "crypto",
    parent_id: 0,
    challenger_count: 1,
    market_type: "binary",
    odds_mode: "pool",
    challenger_payout_bps: 0,
    handicap_line: "",
    settlement_rule:
      "Resolve this using the visible BTC price on the linked CoinMarketCap page at the deadline.",
    max_challengers: 1,
    created_at: EXAMPLE_TIMESTAMP_S - 3_600,
    visibility: "public",
    is_private: false,
    challengers: [
      {
        address: SYNTHETIC_WALLETS.operator,
        stake: 25,
        potential_payout: 50,
        claimed: false,
      },
    ],
    first_challenger: SYNTHETIC_WALLETS.operator,
    challenger_addresses: [SYNTHETIC_WALLETS.operator],
    total_pot: 50,
    resolve_attempts: 0,
    creator_requested_resolve: false,
    challenger_requested_resolve: false,
  };
}

export function buildExampleVsData(): VSData {
  return mapClaimToVS(exampleClaimData());
}

export interface PublicEndpointExample {
  path: PublicReadPath;
  status: number;
  name: string;
  summary: string;
  schemaName: string;
  code?: ApiErrorCode;
  body: unknown;
  headers?: Record<string, string>;
}

function apiErrorExample(
  path: PublicReadPath,
  name: string,
  summary: string,
  code: ApiErrorCode,
  message: string,
  opts: { field?: string; headers?: Record<string, string> } = {},
): PublicEndpointExample {
  const err = apiError(code, message, opts.field ? { field: opts.field } : {});
  const mergedHeaders = { ...err.headers, ...(opts.headers ?? {}) };
  return {
    path,
    status: err.status,
    name,
    summary,
    schemaName: "ApiError",
    code,
    body: { error: { ...err.body.error } },
    ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
  };
}

export function buildPublicEndpointExamples(): PublicEndpointExample[] {
  const vsItem = buildExampleVsData();

  // 1. /api/vs
  const vsFeedOk: PublicEndpointExample = {
    path: "/api/vs",
    status: 200,
    name: "vsFeedPage",
    summary: "Paginated public VS claims with read-index freshness metadata.",
    schemaName: "VSFeedResponse",
    body: {
      items: [vsItem],
      count: 1,
      cache: exampleFreshness("index", 60_000),
      nextCursor: null,
    },
    headers: { ...VS_CACHE_HEADERS },
  };

  // 2. /api/vs/{id}
  const vsDetailPublicOk: PublicEndpointExample = {
    path: "/api/vs/{id}",
    status: 200,
    name: "vsDetailPublic",
    summary: "Public claim detail served from the read index.",
    schemaName: "VSDetailResponse",
    body: {
      item: vsItem,
      cache: exampleFreshness("index", 15_000),
    },
    headers: { ...VS_CACHE_HEADERS },
  };

  const vsDetailPrivateOk: PublicEndpointExample = {
    path: "/api/vs/{id}",
    status: 200,
    name: "vsDetailWithInvite",
    summary: "Private claim unlocked with a valid `?invite=` key, read directly from the contract with `private, no-store` caching.",
    schemaName: "VSDetailResponse",
    body: {
      item: {
        ...vsItem,
        visibility: "private",
        is_private: true,
      },
      cache: exampleFreshness("contract", 1),
    },
    headers: { "Cache-Control": "private, no-store" },
  };

  // 3. /api/vs/{id}/reasoning
  const reasoningEventIdSample = reasoningEventId({
    claimId: 42,
    agentId: "mimir-example-agent",
    stage: "pre_stake",
    sequence: 0,
  });
  const reasoningFeedOk: PublicEndpointExample = {
    path: "/api/vs/{id}/reasoning",
    status: 200,
    name: "reasoningTimeline",
    summary: "Public agent reasoning timeline for claim 42.",
    schemaName: "ReasoningFeedResponse",
    body: {
      claimId: 42,
      count: 1,
      items: [
        {
          eventId: reasoningEventIdSample,
          agentId: "mimir-example-agent",
          track: "classic",
          stage: "pre_stake",
          position: "creator",
          confidenceBps: 7800,
          summary: "Spot volume and ETF inflows support a test of the $100,000 level before the deadline.",
          uncertainty: "Macro policy announcements could compress risk appetite before settlement.",
          evidence: [
            {
              domain: "coinmarketcap.com",
              url: "https://coinmarketcap.com/currencies/bitcoin/",
              capturedAt: EXAMPLE_SIGNED_AT_MS - 60_000,
              contentHash: `0x${"a1".repeat(32)}`,
              freshnessSeconds: 120,
              trustTier: "primary",
            },
          ],
          model: "claude-3-7-sonnet",
          promptVersion: 1,
          beforeStake: true,
          createdAt: EXAMPLE_SIGNED_AT_MS,
        },
      ],
    },
    headers: { "cache-control": "s-maxage=15, stale-while-revalidate=60" },
  };

  const reasoningInvalidId: PublicEndpointExample = {
    path: "/api/vs/{id}/reasoning",
    status: 400,
    name: "invalidClaimId",
    summary: "Non-positive or non-integer claim ID.",
    schemaName: "ReasoningInvalidClaimError",
    body: { error: "invalid claim id" },
  };

  const reasoningDegraded: PublicEndpointExample = {
    path: "/api/vs/{id}/reasoning",
    status: 503,
    name: "databaseUnavailable",
    summary: "Database unconfigured or unreachable; returns an empty timeline with `error` rather than crashing the claim page.",
    schemaName: "ReasoningFeedResponse",
    body: {
      claimId: 42,
      count: 0,
      items: [],
      error: "DATABASE_URL is not configured",
    },
  };

  // 4. /api/vs/user/{address}
  const vsUserOk: PublicEndpointExample = {
    path: "/api/vs/user/{address}",
    status: 200,
    name: "userVsFeed",
    summary: "Claims where the Stellar address participated as creator or challenger.",
    schemaName: "VSUserFeedResponse",
    body: {
      items: [vsItem],
      count: 1,
      cache: exampleFreshness("index", 60_000),
    },
    headers: { ...VS_CACHE_HEADERS },
  };

  // 5. /api/challenge-opportunities
  const seed = getSeedChallengeOpportunities("en")[0]!;
  const seedQuality = computeClaimQuality(
    {
      question: seed.candidate.claimText,
      creator_position: seed.candidate.sideA,
      opponent_position: seed.candidate.sideB,
      resolution_url: seed.candidate.primaryResolutionSource,
      settlement_rule: seed.candidate.settlementRule,
      category: seed.candidate.category,
      deadline: Math.floor(Date.parse(seed.candidate.deadlineAt) / 1000),
    },
    EXAMPLE_TIMESTAMP_S,
  );
  const opportunitiesBody: ChallengeOpportunitiesResponse = {
    items: [
      {
        id: seed.id,
        sourceUrl: seed.sourceUrl,
        sourceType: seed.sourceType,
        sourceSummary: seed.sourceSummary,
        candidate: seed.candidate,
        claimStrengthScore: seedQuality.score,
        claimStrengthTier: seedQuality.tier,
        action: "create",
      },
    ],
    count: 1,
    generatedAt: EXAMPLE_ISO_TIMESTAMP,
  };
  const opportunitiesOk: PublicEndpointExample = {
    path: "/api/challenge-opportunities",
    status: 200,
    name: "challengeOpportunitiesList",
    summary: "Ranked challenge and claim creation opportunities.",
    schemaName: "ChallengeOpportunitiesResponse",
    body: opportunitiesBody,
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=300" },
  };

  // 6. /api/performance/{address}
  const sampleTrades: AgentTradeRow[] = [
    {
      claimId: 10,
      role: "creator",
      stake: 20,
      opposingStake: 20,
      potentialPayout: 40,
      state: "resolved",
      winnerSide: "creator",
      settledAt: EXAMPLE_SIGNED_AT_MS - 86_400_000,
      category: "crypto",
      question: "Sample settled win",
    },
    {
      claimId: 15,
      role: "challenger",
      stake: 10,
      opposingStake: 10,
      potentialPayout: 20,
      state: "resolved",
      winnerSide: "creator",
      settledAt: EXAMPLE_SIGNED_AT_MS - 3_600_000,
      category: "sports",
      question: "Sample settled loss",
    },
  ];
  const { performance, results } = computeAgentPerformance(sampleTrades);
  const performanceBody: PortfolioPerformanceResponse = {
    points: cumulativePnlPoints(results),
    settled: performance.settled,
    cache: exampleFreshness("index", 300_000),
  };
  const performanceOk: PublicEndpointExample = {
    path: "/api/performance/{address}",
    status: 200,
    name: "portfolioPerformance",
    summary: "Cumulative realised P&L series computed from settled markets.",
    schemaName: "PortfolioPerformanceResponse",
    body: performanceBody,
    headers: { "Cache-Control": "no-store" },
  };

  // 7. /api/baskets
  const sampleBasket: StoredBasket = {
    basketId: "council-momentum-000001",
    creatorWallet: SYNTHETIC_WALLETS.owner,
    name: "Council Momentum",
    thesis: "Balanced exposure across classic and oracle council tracks.",
    membersJson: JSON.stringify([
      { agentId: "socrates", weightBps: 4_000 },
      { agentId: "athena", weightBps: 3_500 },
      { agentId: "apollo", weightBps: 2_500 },
    ]),
    createdAt: EXAMPLE_SIGNED_AT_MS,
    subscriberCount: 4,
  };
  const basketsOk: PublicEndpointExample = {
    path: "/api/baskets",
    status: 200,
    name: "basketsList",
    summary: "User-composed agent baskets ordered by newest first.",
    schemaName: "BasketsListResponse",
    body: { baskets: [sampleBasket] },
    headers: { "cache-control": "no-store" },
  };

  // 8. /api/health
  const healthySnapshot: HealthSnapshot = {
    workers: MONITORED_WORKERS.map((name) => ({
      name,
      lastBeatAtMs: EXAMPLE_SIGNED_AT_MS - 15_000,
      expectedIntervalSec: 60,
      lastTraceId: "mh_0196ed40000070008000000000000001",
    })),
    indexLastSyncAgeSec: 12,
    oldestQueuedJobAgeSec: 0,
    oldestOverdueSettlementSec: 0,
    oracleBacklog: 0,
    rpc: { attempts: 40, failures: 0 },
    facilitator: { attempts: 25, failures: 0 },
    sources: { attempts: 30, failures: 1 },
    agentBalancesUsdc: {
      oracle: 125.5,
      market_creator: 84.0,
    },
  };
  const healthyReport = evaluateHealth(healthySnapshot, EXAMPLE_SIGNED_AT_MS);
  const healthOk: PublicEndpointExample = {
    path: "/api/health",
    status: healthHttpStatus(healthyReport.status),
    name: "healthyProbe",
    summary: "All monitored workers, sync cursors, and balances within thresholds (200 OK).",
    schemaName: "HealthProbeResponse",
    body: {
      ...healthyReport,
      operationalStatusUrl: "/api/health/status",
    },
    headers: { "Cache-Control": "no-store" },
  };

  const healthCriticalUnconfigured: PublicEndpointExample = {
    path: "/api/health",
    status: 503,
    name: "criticalDbUnconfigured",
    summary: "Fail-closed 503 probe when `DATABASE_URL` is not configured or a critical alarm fires.",
    schemaName: "HealthProbeResponse",
    body: {
      status: "critical",
      alarms: [
        {
          id: "db.unconfigured",
          severity: "critical",
          message: "DATABASE_URL is not configured",
        },
      ],
      operationalStatusUrl: "/api/health/status",
    },
    headers: { "Cache-Control": "no-store" },
  };

  return [
    // /api/vs
    vsFeedOk,
    apiErrorExample("/api/vs", "invalidLimit", "Query parameter validation failure (`refresh`, `cursor`, or `limit`).", "invalid_request", "limit must be between 1 and 100", { field: "limit" }),
    apiErrorExample("/api/vs", "rateLimited", "Public read rate limit exceeded.", "rate_limited", "ip limit exceeded; retry in 60s"),
    apiErrorExample("/api/vs", "internalError", "Unhandled feed read failure.", "internal_error", "Unable to load VS feed"),

    // /api/vs/{id}
    vsDetailPublicOk,
    vsDetailPrivateOk,
    apiErrorExample("/api/vs/{id}", "invalidId", "Path `{id}` is not a positive integer or `?invite=` is malformed.", "invalid_request", "Invalid VS id", { field: "id" }),
    apiErrorExample("/api/vs/{id}", "notFound", "Claim does not exist, or is private and no matching `?invite=` key was provided.", "not_found", "VS not found"),
    apiErrorExample("/api/vs/{id}", "inviteRateLimited", "Rate limit exceeded while probing `?invite=` keys.", "rate_limited", "ip limit exceeded; retry in 60s"),
    apiErrorExample("/api/vs/{id}", "internalError", "Unhandled claim detail error.", "internal_error", "Unable to load VS"),

    // /api/vs/{id}/reasoning
    reasoningFeedOk,
    reasoningInvalidId,
    reasoningDegraded,

    // /api/vs/user/{address}
    vsUserOk,
    apiErrorExample("/api/vs/user/{address}", "invalidAddress", "Path `{address}` is not a valid Stellar `G…` or `C…` strkey, or `refresh` is not `1`.", "invalid_request", "Invalid address", { field: "address" }),
    apiErrorExample("/api/vs/user/{address}", "internalError", "Unhandled user VS feed error.", "internal_error", "Unable to load user VS"),

    // /api/challenge-opportunities
    opportunitiesOk,
    apiErrorExample("/api/challenge-opportunities", "invalidLimit", "`limit` query parameter is not a valid integer.", "invalid_request", "limit must be a valid integer", { field: "limit" }),
    apiErrorExample("/api/challenge-opportunities", "featureDisabled", "`NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS` is not enabled.", "not_found", "Challenge opportunities are not enabled"),
    apiErrorExample("/api/challenge-opportunities", "internalError", "Unexpected failure building challenge opportunities.", "internal_error", "Unable to load challenge opportunities"),
    apiErrorExample("/api/challenge-opportunities", "upstreamUnavailable", "Draft generator upstream is not configured or unavailable.", "upstream_unavailable", "Draft generator is not configured"),

    // /api/performance/{address}
    performanceOk,
    apiErrorExample("/api/performance/{address}", "invalidAddress", "Path `{address}` is not a valid Stellar `G…` or `C…` strkey.", "invalid_request", "Invalid address", { field: "address", headers: { "Cache-Control": "no-store" } }),
    apiErrorExample("/api/performance/{address}", "upstreamUnavailable", "Database or settlement index unavailable.", "upstream_unavailable", "Unable to load portfolio performance", { headers: { "Cache-Control": "no-store" } }),

    // /api/baskets
    basketsOk,
    apiErrorExample("/api/baskets", "rateLimited", "Public read rate limit exceeded.", "rate_limited", "ip limit exceeded; retry in 60s"),

    // /api/health
    healthOk,
    healthCriticalUnconfigured,
  ];
}

// ── Building the OpenAPI 3.1 Document ─────────────────────────────────────────

const GENERATED_HEADER = [
  "GENERATED FILE — DO NOT EDIT BY HAND.",
  "",
  "Published OpenAPI 3.1 contract for the Mimir public read API. Every schema,",
  "parameter, cache header, rate-limit rule, and example below is derived from",
  "the live route dependencies (lib/ops/public-api-openapi.ts) and verified",
  "against lib/ops/json-schema-subset.ts in tests/node/public-api-openapi.test.ts.",
];

function buildResponsesForPath(
  path: PublicReadPath,
  allExamples: readonly PublicEndpointExample[],
  schemas: Record<string, Record<string, unknown>>,
): Record<string, YamlValue> {
  const pathExamples = allExamples.filter((ex) => ex.path === path);
  const byStatus = new Map<number, PublicEndpointExample[]>();
  for (const ex of pathExamples) {
    const bucket = byStatus.get(ex.status) ?? [];
    bucket.push(ex);
    byStatus.set(ex.status, bucket);
  }

  const out: Record<string, YamlValue> = {};
  for (const status of [...byStatus.keys()].sort((a, b) => a - b)) {
    const bucket = byStatus.get(status)!;
    const schemaName = bucket[0]!.schemaName;
    const examplesMap: Record<string, YamlValue> = {};
    for (const ex of bucket) {
      examplesMap[ex.name] = {
        summary: ex.summary,
        ...(ex.code ? { "x-mimir-error-code": ex.code } : {}),
        ...(ex.headers ? { "x-mimir-response-headers": asYamlValue(ex.headers) } : {}),
        value: asYamlValue(ex.body, `$.paths.${path}.get.responses.${status}.${ex.name}`),
      };
    }
    const errorCodes = bucket
      .map((ex) => ex.code)
      .filter((code): code is ApiErrorCode => Boolean(code));

    out[String(status)] = {
      description: describePublicResponseStatus(path, status),
      ...(errorCodes.length > 0 ? { "x-mimir-error-codes": errorCodes } : {}),
      content: {
        "application/json": {
          schema: asYamlValue(
            schemas[schemaName],
            `$.paths.${path}.get.responses.${status}.schema`,
          ),
          examples: examplesMap,
        },
      },
    };
  }
  return out;
}

function describePublicResponseStatus(path: PublicReadPath, status: number): string {
  if (status === 200) {
    return PUBLIC_ENDPOINT_METADATA[path].summary;
  }
  if (status === 400) return "Invalid path or query parameter.";
  if (status === 404) {
    return path === "/api/challenge-opportunities"
      ? "Feature flag `NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS` is not enabled."
      : "Requested resource was not found (or is private without a valid invite key).";
  }
  if (status === 429) return "Rate limit exceeded for the `public_read` access tier.";
  if (status === 503) {
    if (path === "/api/health") {
      return "One or more critical health alarms are active (or `DATABASE_URL` is unconfigured).";
    }
    return "Upstream dependency or database is temporarily unavailable.";
  }
  return "Internal server error.";
}

export function buildPublicOpenApiDocument(): YamlValue {
  const schemas = buildPublicApiSchemas();
  const examples = buildPublicEndpointExamples();
  const publicTier = TIER_POLICIES.public_read;
  const publicRules = DEFAULT_RULES.filter((rule) =>
    publicTier.limitDimensions.includes(rule.dimension),
  );

  const paths: Record<string, YamlValue> = {
    "/api/vs": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/vs"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/vs"].summary,
        description: [
          "Returns public claims ordered by descending claim ID (`id_desc`), along with read-index freshness metadata (`cache`) and an optional `nextCursor` for pagination.",
          "",
          "Private claims are excluded from the public feed. Passing `refresh=1` triggers an index reconciliation before reading.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/vs"].cacheControl,
        "x-mimir-access-tier": "public_read",
        "x-mimir-rate-limit-route": "/api/vs",
        parameters: [
          {
            name: "refresh",
            in: "query",
            required: false,
            description: "Set to `\"1\"` to force a chain-to-index reconciliation before returning. Any other non-empty value is rejected with 400 `invalid_request`.",
            schema: { type: "string", enum: ["1"] },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Positive integer claim ID cursor (`id < cursor`).",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size between 1 and 100 (defaults to 50).",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: buildResponsesForPath("/api/vs", examples, schemas),
      },
    },
    "/api/vs/{id}": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/vs/{id}"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/vs/{id}"].summary,
        description: [
          "Returns a single claim as `VSData` plus its `VSCacheFreshness` descriptor.",
          "",
          "When `?invite=` is omitted, only public claims are returned (`Cache-Control: s-maxage=15, stale-while-revalidate=60`); private claims return 404 `not_found`. When `?invite=` is provided, the route rate-limits the guess under `/api/vs/[id]?invite`, verifies the key hash against the on-chain `invite_key_hash`, and responds with `Cache-Control: private, no-store`.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/vs/{id}"].cacheControl,
        "x-mimir-access-tier": "public_read",
        "x-mimir-rate-limit-route": "/api/vs/[id]?invite",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Positive integer claim ID (`parsePositiveIntegerParam`).",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "invite",
            in: "query",
            required: false,
            description: "Invite key for unlocking a private claim (`INVITE_KEY_PATTERN`).",
            schema: { type: "string", pattern: INVITE_KEY_REGEX_SOURCE, minLength: 1, maxLength: 128 },
          },
        ],
        responses: buildResponsesForPath("/api/vs/{id}", examples, schemas),
      },
    },
    "/api/vs/{id}/reasoning": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/vs/{id}/reasoning"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/vs/{id}/reasoning"].summary,
        description: [
          "Returns the append-only public reasoning timeline for a claim (`agent_reasoning_events` with `visibility = 'public'` and `tombstoned_at IS NULL`).",
          "",
          "Hidden chain-of-thought is never stored or published. Each item includes `beforeStake` (`true` for `preflight` and `pre_stake` stages) so readers can distinguish pre-commitment analysis from post-stake commentary.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/vs/{id}/reasoning"].cacheControl,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Positive integer claim ID.",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "track",
            in: "query",
            required: false,
            description: "Filter events by agent track (`classic`, `philosopher`, `oracle`, `external`).",
            schema: { type: "string", enum: [...REASONING_TRACKS] },
          },
          {
            name: "agent",
            in: "query",
            required: false,
            description: "Filter events by registry `agentId`.",
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "stage",
            in: "query",
            required: false,
            description: "Filter events by `ReasoningStage`. Unrecognized stage values are ignored.",
            schema: { type: "string", enum: [...REASONING_STAGES] },
          },
        ],
        responses: buildResponsesForPath("/api/vs/{id}/reasoning", examples, schemas),
      },
    },
    "/api/vs/user/{address}": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/vs/user/{address}"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/vs/user/{address}"].summary,
        description: [
          "Lists claims where `{address}` is either the creator or a challenger, ordered by descending claim ID.",
          "",
          "`{address}` must be a valid case-sensitive Stellar `G…` account or `C…` contract strkey (`parseAddressParam`). Private claim text fields are sanitized to empty strings on public reads.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/vs/user/{address}"].cacheControl,
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            description: "Case-sensitive Stellar `G…` account or `C…` contract strkey.",
            schema: { type: "string", pattern: STELLAR_ADDRESS_PATTERN },
          },
          {
            name: "refresh",
            in: "query",
            required: false,
            description: "Set to `\"1\"` to force hydration from the contract before returning.",
            schema: { type: "string", enum: ["1"] },
          },
        ],
        responses: buildResponsesForPath("/api/vs/user/{address}", examples, schemas),
      },
    },
    "/api/challenge-opportunities": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/challenge-opportunities"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/challenge-opportunities"].summary,
        description: [
          "Returns curated and source-generated claim opportunities scored by `computeClaimQuality` (`lib/claimQuality.ts`).",
          "",
          "Gated on `NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS=1`; returns 404 `not_found` when disabled.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/challenge-opportunities"].cacheControl,
        "x-mimir-feature-flag": "NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS",
        parameters: [
          {
            name: "locale",
            in: "query",
            required: false,
            description: "Opportunity copy locale (`\"es\"` selects Spanish; any other value defaults to `\"en\"`).",
            schema: { type: "string", enum: ["en", "es"], default: "en" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Maximum number of opportunities to return (`Number.parseInt(limit, 10)`).",
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: buildResponsesForPath("/api/challenge-opportunities", examples, schemas),
      },
    },
    "/api/performance/{address}": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/performance/{address}"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/performance/{address}"].summary,
        description: [
          "Computes cumulative realised P&L points in display USDC (`cumulativePnlPoints`) from settled markets where `{address}` participated, alongside the settled trade count and settlement sync freshness.",
          "",
          "All internal accounting is performed in 7-decimal atomic USDC (`lib/agents/performance.ts`) before converting the display series.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/performance/{address}"].cacheControl,
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            description: "Case-sensitive Stellar `G…` account or `C…` contract strkey.",
            schema: { type: "string", pattern: STELLAR_ADDRESS_PATTERN },
          },
        ],
        responses: buildResponsesForPath("/api/performance/{address}", examples, schemas),
      },
    },
    "/api/baskets": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/baskets"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/baskets"].summary,
        description: [
          "Lists user-composed agent baskets with their active subscriber counts, ordered by newest first (`limit = 100`).",
          "",
          "Rate-limited under the `public_read` access tier. If the database is unreachable, degrades gracefully to `{ baskets: [] }`.",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/baskets"].cacheControl,
        "x-mimir-access-tier": "public_read",
        "x-mimir-rate-limit-route": "/api/baskets",
        responses: buildResponsesForPath("/api/baskets", examples, schemas),
      },
    },
    "/api/health": {
      get: {
        operationId: PUBLIC_ENDPOINT_METADATA["/api/health"].operationId,
        summary: PUBLIC_ENDPOINT_METADATA["/api/health"].summary,
        description: [
          "Unauthenticated operational health probe (`lib/ops/health.ts`).",
          "",
          "Returns HTTP 200 for `ok` and `warn` states so load balancers do not pull the app out of rotation over a degraded soft dependency, and HTTP 503 only when `status` is `critical` (including when `DATABASE_URL` is unconfigured).",
        ].join("\n"),
        "x-mimir-cache-control": PUBLIC_ENDPOINT_METADATA["/api/health"].cacheControl,
        responses: buildResponsesForPath("/api/health", examples, schemas),
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Mimir Public Read API",
      version: PUBLIC_API_VERSION,
      summary: "Unauthenticated read endpoints for markets, reasoning timelines, baskets, portfolio performance, and operational health.",
      description: [
        "Mimir runs on Stellar Testnet (CAIP-2 `stellar:testnet`). Every participant address is a case-sensitive Stellar `G…` account or `C…` contract strkey — never lowercase one.",
        "",
        "These endpoints are read-only and unauthenticated. Routes gated by `authorizeRequest(\"public_read\", …)` enforce per-IP and per-route fixed-window rate limits (`lib/api/rate-limit.ts`). Indexed market reads include a `VSCacheFreshness` block (`lib/vs-freshness.ts`) so callers can distinguish live contract reads from cached or stale index snapshots.",
      ].join("\n"),
      contact: { name: "Mimir", url: SERVER_URL_PLACEHOLDER },
      "x-mimir-generated-by": "lib/ops/public-api-openapi.ts",
    },
    servers: [
      {
        url: SERVER_URL_PLACEHOLDER,
        description:
          "Placeholder host. Substitute your deployment URL in your own copy; the audit reports SERVER_URL_NOT_PLACEHOLDER as a warning.",
      },
    ],
    paths,
    components: {
      schemas: asYamlValue(schemas, "$.components.schemas"),
    },
    "x-mimir-rate-limits": {
      tier: publicTier.tier,
      dimensions: [...publicTier.limitDimensions],
      rules: publicRules.map((rule) => ({
        dimension: rule.dimension,
        limit: rule.limit,
        windowMs: rule.windowMs,
      })),
    },
    "x-mimir-freshness": {
      vsCacheControlHeader: VS_CACHE_HEADERS["Cache-Control"],
      vsRevalidateSeconds: VS_REVALIDATE_SECONDS,
      listFreshnessWindowMs: 60_000,
      detailFreshnessWindowMs: 15_000,
      performanceDefaultFreshnessWindowMs: 300_000,
      staleMultiplier: 5,
    },
    "x-mimir-basket-policy": {
      maxSingleAgentBps: DEFAULT_BASKET_POLICY.maxSingleAgentBps,
      maxCategoryBps: DEFAULT_BASKET_POLICY.maxCategoryBps,
      staleSignalAction: DEFAULT_BASKET_POLICY.staleSignalAction,
      failedCopyAction: DEFAULT_BASKET_POLICY.failedCopyAction,
    },
    "x-mimir-health-thresholds": {
      minSamples: MIN_SAMPLES,
      monitoredWorkers: [...MONITORED_WORKERS],
      thresholds: asYamlValue(DEFAULT_THRESHOLDS, "$.x-mimir-health-thresholds.thresholds"),
    },
  };
}

// ── Rendering & Drift Check ───────────────────────────────────────────────────

export function renderPublicOpenApiArtifact(): RenderedArtifact {
  return {
    relativePath: PUBLIC_OPENAPI_RELATIVE,
    contents: toYaml(buildPublicOpenApiDocument(), { header: GENERATED_HEADER }),
  };
}

export interface PublicApiArtifactCheck {
  audit: PublicOpenApiAudit;
  drifted: RenderedArtifact[];
  committed: Map<string, string | undefined>;
}

export function checkPublicApiArtifacts(
  read: (relativePath: string) => string | undefined,
): PublicApiArtifactCheck {
  const artifact = renderPublicOpenApiArtifact();
  const doc = buildPublicOpenApiDocument();
  const schemas = buildPublicApiSchemas();
  const committed = new Map<string, string | undefined>();
  const drifted: RenderedArtifact[] = [];

  const onDisk = read(artifact.relativePath);
  committed.set(artifact.relativePath, onDisk);
  if (onDisk !== artifact.contents) {
    drifted.push(artifact);
  }

  const audit = auditPublicApiDocument({
    doc,
    schemas,
    rendered: artifact.contents,
  });

  for (const item of drifted) {
    const diskText = committed.get(item.relativePath);
    const how =
      diskText === undefined
        ? "the generated artifact is not committed"
        : `the committed artifact does not match the live code (committed ${diskText.length} bytes, generated ${item.contents.length} bytes)`;
    audit.findings.push(
      finding(
        diskText === undefined ? "ARTIFACT_MISSING" : "ARTIFACT_DRIFT",
        "error",
        item.relativePath,
        `${how}; regenerate ${ PUBLIC_OPENAPI_RELATIVE } from lib/ops/public-api-openapi.ts`,
      ),
    );
  }

  audit.ok = audit.findings.every((item) => item.severity !== "error");
  return { audit, drifted, committed };
}

export function formatPublicArtifactReport(check: PublicApiArtifactCheck): string {
  const errors = check.audit.findings.filter((item) => item.severity === "error");
  const warnings = check.audit.findings.filter((item) => item.severity === "warning");
  const lines = [
    `public read API contract: ${
      check.audit.ok ? "OK" : `FAILED (${errors.length} error(s), ${warnings.length} warning(s))`
    }`,
  ];
  for (const item of check.audit.findings) {
    lines.push(
      `  ${item.severity === "error" ? "✗" : "!"} ${item.code} at ${item.where}: ${item.message}`,
    );
  }
  return lines.join("\n");
}

// ── Audit ─────────────────────────────────────────────────────────────────────

const WALLET_SHAPES = [/\bG[A-Z2-7]{55}\b/g, /\bC[A-Z2-7]{55}\b/g];

function isSyntheticOnly(text: string): boolean {
  for (const shape of WALLET_SHAPES) {
    for (const match of text.matchAll(shape)) {
      if (!SYNTHETIC_WALLET_VALUES.includes(match[0])) return false;
    }
  }
  return true;
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      walkStrings(item, `${path}.${key}`, visit);
    }
  }
}

export function auditPublicApiDocument(input: {
  doc: unknown;
  schemas?: Record<string, Record<string, unknown>>;
  rendered?: string;
}): PublicOpenApiAudit {
  const findings: PublicOpenApiFinding[] = [];
  const { doc } = input;
  const liveSchemas = input.schemas ?? buildPublicApiSchemas();

  if (!isPlainObject(doc)) {
    return {
      ok: false,
      findings: [
        finding(
          "DOC_MISSING_PATH",
          "error",
          PUBLIC_OPENAPI_RELATIVE,
          "the document root is not an object",
        ),
      ],
    };
  }

  // 1. OpenAPI 3.1 version & server placeholder
  if (str(doc.openapi) !== "3.1.0") {
    findings.push(
      finding(
        "DOC_INVALID_OPENAPI_VERSION",
        "error",
        "$.openapi",
        `expected OpenAPI version "3.1.0", found "${String(doc.openapi ?? "nothing")}"`,
      ),
    );
  }

  const serverUrl = asArray(doc.servers)[0];
  const serverValue = isPlainObject(serverUrl) ? str(serverUrl.url) : undefined;
  if (serverValue !== undefined && serverValue !== SERVER_URL_PLACEHOLDER) {
    findings.push(
      finding(
        "SERVER_URL_NOT_PLACEHOLDER",
        "warning",
        "$.servers[0].url",
        "the published document names a non-placeholder host",
      ),
    );
  }

  // 2. Validate component schemas with json-schema-subset
  const components = isPlainObject(doc.components) ? doc.components : {};
  const docSchemas = isPlainObject(components.schemas) ? components.schemas : {};
  const checkableSchemas = new Set<string>();

  for (const [name, liveSchema] of Object.entries(liveSchemas)) {
    const publishedSchema = docSchemas[name];
    if (!isPlainObject(publishedSchema)) {
      findings.push(
        finding(
          "DOC_MISSING_SCHEMA",
          "error",
          `$.components.schemas.${name}`,
          `component schema "${name}" is missing from the document`,
        ),
      );
      continue;
    }
    try {
      assertSupportedKeywords(publishedSchema, `$.components.schemas.${name}`);
      assertSupportedKeywords(liveSchema, `$.components.schemas.${name}`);
      checkableSchemas.add(name);
    } catch (error) {
      findings.push(
        finding(
          "DOC_SCHEMA_UNSUPPORTED",
          "error",
          `$.components.schemas.${name}`,
          `component schema "${name}" uses an unsupported keyword: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }

  // 3. Rate limit metadata drift
  const rateLimits = isPlainObject(doc["x-mimir-rate-limits"]) ? doc["x-mimir-rate-limits"] : {};
  const livePublicRules = DEFAULT_RULES.filter((rule) =>
    TIER_POLICIES.public_read.limitDimensions.includes(rule.dimension),
  );
  const publishedRules = asArray(rateLimits.rules);
  if (
    str(rateLimits.tier) !== "public_read" ||
    JSON.stringify(rateLimits.dimensions) !== JSON.stringify(TIER_POLICIES.public_read.limitDimensions) ||
    JSON.stringify(publishedRules) !==
      JSON.stringify(
        livePublicRules.map((r) => ({
          dimension: r.dimension,
          limit: r.limit,
          windowMs: r.windowMs,
        })),
      )
  ) {
    findings.push(
      finding(
        "DOC_RATE_LIMIT_DRIFT",
        "error",
        "$.x-mimir-rate-limits",
        "published public_read rate-limit rules do not match lib/api/policy.ts and lib/api/rate-limit.ts",
      ),
    );
  }

  // 4. Paths, operations, parameters, cache headers, responses & examples
  const pathsObj = isPlainObject(doc.paths) ? doc.paths : {};
  for (const pathKey of Object.keys(pathsObj)) {
    if (!(PUBLIC_READ_PATHS as readonly string[]).includes(pathKey)) {
      findings.push(
        finding(
          "DOC_UNKNOWN_PATH",
          "error",
          `$.paths.${pathKey}`,
          `document publishes path "${pathKey}", which is not in PUBLIC_READ_PATHS`,
        ),
      );
    }
  }

  const liveExamples = buildPublicEndpointExamples();
  const catalogue = apiErrorCatalogue();

  for (const pathKey of PUBLIC_READ_PATHS) {
    const meta = PUBLIC_ENDPOINT_METADATA[pathKey];
    const pathItem = pathsObj[pathKey];
    if (!isPlainObject(pathItem)) {
      findings.push(
        finding(
          "DOC_MISSING_PATH",
          "error",
          `$.paths.${pathKey}`,
          `public read path "${pathKey}" is missing from the document`,
        ),
      );
      continue;
    }

    const getOp = pathItem.get;
    if (!isPlainObject(getOp)) {
      findings.push(
        finding(
          "DOC_MISSING_OPERATION",
          "error",
          `$.paths.${pathKey}.get`,
          `GET operation is missing for "${pathKey}"`,
        ),
      );
      continue;
    }

    if (str(getOp["x-mimir-cache-control"]) !== meta.cacheControl) {
      findings.push(
        finding(
          "DOC_CACHE_HEADER_DRIFT",
          "error",
          `$.paths.${pathKey}.get.x-mimir-cache-control`,
          `published cache-control "${String(getOp["x-mimir-cache-control"])}" does not match live "${meta.cacheControl}"`,
        ),
      );
    }

    if (meta.rateLimited) {
      if (
        str(getOp["x-mimir-access-tier"]) !== "public_read" ||
        str(getOp["x-mimir-rate-limit-route"]) !== meta.rateLimitRouteKey
      ) {
        findings.push(
          finding(
            "DOC_RATE_LIMIT_DRIFT",
            "error",
            `$.paths.${pathKey}.get.x-mimir-rate-limit-route`,
            `published rate-limit metadata for "${pathKey}" does not match live route key "${String(meta.rateLimitRouteKey)}"`,
          ),
        );
      }
    }

    // Check parameters for path variables
    const params = asArray(getOp.parameters).filter(isPlainObject);
    if (pathKey.includes("{id}")) {
      const idParam = params.find((p) => p.name === "id" && p.in === "path");
      const idSchema = isPlainObject(idParam?.schema) ? idParam.schema : undefined;
      if (!idParam || idParam.required !== true || idSchema?.type !== "integer" || idSchema?.minimum !== 1) {
        findings.push(
          finding(
            "DOC_PARAMETER_DRIFT",
            "error",
            `$.paths.${pathKey}.get.parameters[id]`,
            `path parameter "id" on "${pathKey}" must be a required positive integer (minimum: 1)`,
          ),
        );
      }
    }
    if (pathKey.includes("{address}")) {
      const addrParam = params.find((p) => p.name === "address" && p.in === "path");
      const addrSchema = isPlainObject(addrParam?.schema) ? addrParam.schema : undefined;
      if (
        !addrParam ||
        addrParam.required !== true ||
        addrSchema?.type !== "string" ||
        addrSchema?.pattern !== STELLAR_ADDRESS_PATTERN
      ) {
        findings.push(
          finding(
            "DOC_PARAMETER_DRIFT",
            "error",
            `$.paths.${pathKey}.get.parameters[address]`,
            `path parameter "address" on "${pathKey}" must require pattern ${STELLAR_ADDRESS_PATTERN}`,
          ),
        );
      }
    }

    // Check responses & examples
    const responses = isPlainObject(getOp.responses) ? getOp.responses : {};
    for (const expectedStatus of meta.statuses) {
      const statusKey = String(expectedStatus);
      const responseObj = responses[statusKey];
      if (!isPlainObject(responseObj)) {
        findings.push(
          finding(
            "DOC_MISSING_RESPONSE",
            "error",
            `$.paths.${pathKey}.get.responses.${statusKey}`,
            `status ${statusKey} is undocumented on "${pathKey}"`,
          ),
        );
        continue;
      }

      const content = isPlainObject(responseObj.content) ? responseObj.content : {};
      const appJson = isPlainObject(content["application/json"]) ? content["application/json"] : {};
      const responseSchema = appJson.schema;
      if (!isPlainObject(responseSchema)) {
        findings.push(
          finding(
            "DOC_MISSING_SCHEMA",
            "error",
            `$.paths.${pathKey}.get.responses.${statusKey}.content.application/json.schema`,
            `response schema is missing for ${pathKey} ${statusKey}`,
          ),
        );
      } else {
        try {
          assertSupportedKeywords(
            responseSchema,
            `$.paths.${pathKey}.get.responses.${statusKey}.schema`,
          );
        } catch (error) {
          findings.push(
            finding(
              "DOC_SCHEMA_UNSUPPORTED",
              "error",
              `$.paths.${pathKey}.get.responses.${statusKey}.schema`,
              `response schema uses an unsupported keyword: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      }

      const publishedExamples = isPlainObject(appJson.examples) ? appJson.examples : {};
      const expectedExamples = liveExamples.filter(
        (ex) => ex.path === pathKey && ex.status === expectedStatus,
      );

      for (const expectedEx of expectedExamples) {
        const pubEx = publishedExamples[expectedEx.name];
        if (!isPlainObject(pubEx)) {
          findings.push(
            finding(
              "EXAMPLE_MISSING",
              "error",
              `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
              `example "${expectedEx.name}" is missing from ${pathKey} ${statusKey}`,
            ),
          );
          continue;
        }

        const value = pubEx.value;
        // Validate against both the inline response schema and the component schema
        if (isPlainObject(responseSchema)) {
          try {
            const verdict = validateAgainstSchema(
              responseSchema,
              value,
              `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}.value`,
            );
            if (!verdict.ok) {
              findings.push(
                finding(
                  "EXAMPLE_SCHEMA_REJECTED",
                  "error",
                  `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
                  `example "${expectedEx.name}" failed response schema validation: ${verdict.errors.slice(0, 3).join("; ")}`,
                ),
              );
            }
          } catch (error) {
            findings.push(
              finding(
                "DOC_SCHEMA_UNSUPPORTED",
                "error",
                `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        }

        if (checkableSchemas.has(expectedEx.schemaName)) {
          const compSchema = docSchemas[expectedEx.schemaName];
          const verdict = validateAgainstSchema(
            compSchema,
            value,
            `$.components.schemas.${expectedEx.schemaName}`,
          );
          if (!verdict.ok) {
            findings.push(
              finding(
                "EXAMPLE_SCHEMA_REJECTED",
                "error",
                `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
                `example "${expectedEx.name}" failed component schema "${expectedEx.schemaName}": ${verdict.errors.slice(0, 3).join("; ")}`,
              ),
            );
          }
        }

        // Check error code semantics against live apiErrorCatalogue()
        const declaredCode = str(pubEx["x-mimir-error-code"]);
        if (expectedEx.code || declaredCode) {
          const codeToCheck = declaredCode ?? expectedEx.code!;
          const spec = catalogue.find((item) => item.code === codeToCheck);
          if (!spec || statusFor(codeToCheck as ApiErrorCode) !== expectedStatus) {
            findings.push(
              finding(
                "ERROR_STATUS_DRIFT",
                "error",
                `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
                `error code "${codeToCheck}" is documented under HTTP ${statusKey}, which disagrees with lib/api/errors.ts`,
              ),
            );
          } else {
            const errObj =
              isPlainObject(value) && isPlainObject(value.error) ? value.error : undefined;
            if (!errObj || errObj.retryable !== isRetryable(codeToCheck as ApiErrorCode)) {
              findings.push(
                finding(
                  "ERROR_RETRYABLE_DRIFT",
                  "error",
                  `$.paths.${pathKey}.get.responses.${statusKey}.examples.${expectedEx.name}`,
                  `error code "${codeToCheck}" has retryable=${String(errObj?.retryable)}, expected ${String(spec.retryable)}`,
                ),
              );
            }
          }
        }

        // Route-specific runtime guard checks on 200 examples
        if (pathKey === "/api/performance/{address}" && expectedStatus === 200) {
          if (!isPortfolioPerformanceResponse(value)) {
            findings.push(
              finding(
                "EXAMPLE_VALIDATION_DRIFT",
                "error",
                `$.paths.${pathKey}.get.responses.200.examples.${expectedEx.name}`,
                "performance example is rejected by isPortfolioPerformanceResponse()",
              ),
            );
          }
        }
      }
    }
  }

  // 5. Live validator sanity check on parameters used in examples
  if (
    parsePositiveIntegerParam("42") !== 42 ||
    parseAddressParam(SYNTHETIC_WALLETS.owner) !== SYNTHETIC_WALLETS.owner ||
    parseInviteKey("invite_example_key_01") !== "invite_example_key_01"
  ) {
    findings.push(
      finding(
        "EXAMPLE_VALIDATION_DRIFT",
        "error",
        "lib/server/api-validation.ts",
        "synthetic parameter examples no longer pass lib/server/api-validation.ts",
      ),
    );
  }

  // 6. Safety: secret and wallet scans
  for (const walletFinding of auditSyntheticWallets()) {
    findings.push(
      finding(
        walletFinding.code as PublicOpenApiFindingCode,
        walletFinding.severity,
        walletFinding.where,
        walletFinding.message,
      ),
    );
  }
  if (input.rendered) {
    for (const textFinding of auditPublishedText(input.rendered, PUBLIC_OPENAPI_RELATIVE)) {
      findings.push(
        finding(
          textFinding.code as PublicOpenApiFindingCode,
          textFinding.severity,
          textFinding.where,
          textFinding.message,
        ),
      );
    }
  }
  walkStrings(doc, "$", (text, where) => {
    if (unallowedSecretIn(text)) {
      findings.push(
        finding(
          "SECRET_MATERIAL_IN_DOCS",
          "error",
          where,
          "a credential-shaped string appears in the document that is not an allowed placeholder",
        ),
      );
    }
    if (
      text !== ZERO_ADDRESS &&
      WALLET_SHAPES.some((shape) => new RegExp(shape).test(text)) &&
      !isSyntheticOnly(text)
    ) {
      findings.push(
        finding(
          "PLACEHOLDER_WALLET_UNKNOWN",
          "error",
          where,
          "this string names a wallet that is not one of the synthetic placeholders in SYNTHETIC_WALLETS",
        ),
      );
    }
  });

  const ok = findings.every((item) => item.severity !== "error");
  return { ok, findings };
}
