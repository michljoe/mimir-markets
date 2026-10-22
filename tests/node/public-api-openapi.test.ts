/**
 * The published public read API contract must match the live route definitions.
 *
 * Tests:
 *   1. OpenAPI 3.1 structure, path completeness, and determinism.
 *   2. Drift check against the committed `docs/openapi-public-v1.yaml`.
 *   3. Schema validation of every component schema and every response example
 *      using `lib/ops/json-schema-subset.ts` (`assertSupportedKeywords` and
 *      `validateAgainstSchema`), including negative validation tests.
 *   4. Drift detection when a route's documented shape, cache header, rate
 *      limit, parameter, error status/retryable flag, or example changes without
 *      regenerating.
 *   5. Secret and placeholder wallet safety.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  JsonSchemaError,
  assertSupportedKeywords,
  validateAgainstSchema,
} from "../../lib/ops/json-schema-subset";
import { SYNTHETIC_WALLETS } from "../../lib/ops/agent-api-openapi";
import {
  PUBLIC_ENDPOINT_METADATA,
  PUBLIC_OPENAPI_RELATIVE,
  PUBLIC_READ_PATHS,
  auditPublicApiDocument,
  buildExampleVsData,
  buildPublicApiSchemas,
  buildPublicEndpointExamples,
  buildPublicOpenApiDocument,
  checkPublicApiArtifacts,
  formatPublicArtifactReport,
  renderPublicOpenApiArtifact,
  type PublicOpenApiAudit,
  type PublicReadPath,
} from "../../lib/ops/public-api-openapi";
import { isPortfolioPerformanceResponse } from "../../lib/portfolio-performance";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function auditWith(
  mutate: (doc: Record<string, unknown>, schemas: Record<string, Record<string, unknown>>) => void,
): PublicOpenApiAudit {
  const doc = clone(buildPublicOpenApiDocument()) as Record<string, unknown>;
  const schemas = clone(buildPublicApiSchemas());
  mutate(doc, schemas);
  const rendered = renderPublicOpenApiArtifact();
  return auditPublicApiDocument({
    doc,
    schemas,
    rendered: rendered.contents,
  });
}

function codes(audit: PublicOpenApiAudit): string[] {
  return audit.findings.map((item) => item.code);
}

function getOperation(doc: Record<string, unknown>, routePath: PublicReadPath): Record<string, unknown> {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
  return paths[routePath]!.get!;
}

function responseExamplesOf(
  doc: Record<string, unknown>,
  routePath: PublicReadPath,
  status: string,
): Record<string, Record<string, unknown>> {
  const responses = getOperation(doc, routePath).responses as Record<string, Record<string, unknown>>;
  const content = responses[status]!.content as Record<string, Record<string, unknown>>;
  return content["application/json"]!.examples as Record<string, Record<string, unknown>>;
}

// ── 1. OpenAPI 3.1 validation & committed artifact drift check ───────────────

test("the generated public OpenAPI document validates as OpenAPI 3.1 and audits clean", () => {
  const doc = buildPublicOpenApiDocument() as Record<string, unknown>;
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.info && typeof doc.info === "object");
  assert.ok(doc.paths && typeof doc.paths === "object");
  assert.ok(doc.components && typeof doc.components === "object");

  const rendered = renderPublicOpenApiArtifact();
  const audit = auditPublicApiDocument({
    doc,
    schemas: buildPublicApiSchemas(),
    rendered: rendered.contents,
  });
  assert.deepEqual(audit.findings, []);
  assert.equal(audit.ok, true);
});

test("the committed docs/openapi-public-v1.yaml matches the live generator output", () => {
  const check = checkPublicApiArtifacts((relativePath) => {
    const absolute = path.join(REPO_ROOT, relativePath);
    try {
      return readFileSync(absolute, "utf8");
    } catch {
      return undefined;
    }
  });
  assert.deepEqual(
    check.drifted.map((artifact) => artifact.relativePath),
    [],
    `committed public OpenAPI artifact drifted: ${formatPublicArtifactReport(check)}`,
  );
  assert.equal(check.audit.ok, true, formatPublicArtifactReport(check));
});

test("generation is deterministic and ignores environment variables", () => {
  const canary = "mk_live_PUBLICOPENAPICANARY0000000000";
  process.env.MIMIR_PUBLIC_OPENAPI_CANARY = canary;
  try {
    const first = renderPublicOpenApiArtifact();
    const second = renderPublicOpenApiArtifact();
    assert.deepEqual(first, second);
    assert.equal(first.contents.includes(canary), false);
  } finally {
    delete process.env.MIMIR_PUBLIC_OPENAPI_CANARY;
  }
});

test("every public read endpoint is documented with its live cache and rate-limit metadata", () => {
  const doc = clone(buildPublicOpenApiDocument()) as Record<string, unknown>;
  const paths = doc.paths as Record<string, unknown>;
  assert.deepEqual(Object.keys(paths), [...PUBLIC_READ_PATHS]);

  for (const routePath of PUBLIC_READ_PATHS) {
    const op = getOperation(doc, routePath);
    const meta = PUBLIC_ENDPOINT_METADATA[routePath];
    assert.equal(op.operationId, meta.operationId);
    assert.equal(op["x-mimir-cache-control"], meta.cacheControl);
    const responses = op.responses as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(responses).map(Number).sort((a, b) => a - b),
      [...meta.statuses].sort((a, b) => a - b),
      `${routePath} response statuses`,
    );
  }
});

// ── 2. Schema validation tests using lib/ops/json-schema-subset.ts ───────────

test("every component schema uses only supported keywords from json-schema-subset.ts", () => {
  const schemas = buildPublicApiSchemas();
  assert.ok(Object.keys(schemas).length >= 16);
  for (const [name, schema] of Object.entries(schemas)) {
    assert.doesNotThrow(
      () => assertSupportedKeywords(schema, `$.components.schemas.${name}`),
      `schema ${name} must use only supported keywords`,
    );
  }
});

test("every published example validates against its component schema via validateAgainstSchema", () => {
  const schemas = buildPublicApiSchemas();
  const examples = buildPublicEndpointExamples();
  assert.ok(examples.length >= 20);

  for (const ex of examples) {
    const schema = schemas[ex.schemaName];
    assert.ok(schema, `missing schema ${ex.schemaName} for ${ex.path} ${ex.name}`);
    const verdict = validateAgainstSchema(
      schema,
      ex.body,
      `${ex.path}#${ex.status}.${ex.name}`,
    );
    assert.deepEqual(verdict.errors, [], `example ${ex.path} ${ex.name} failed validation`);
    assert.equal(verdict.ok, true);
  }
});

test("component schemas reject malformed payloads via validateAgainstSchema", () => {
  const schemas = buildPublicApiSchemas();

  // VSFeedResponse: missing cache or invalid Stellar creator address
  const badVsFeed = {
    items: [{ ...buildExampleVsData(), creator: "0x1234" }],
    count: 1,
    cache: {
      source: "index",
      status: "live",
      lastUpdatedAt: null,
      ageMs: null,
      freshnessWindowMs: 60_000,
    },
  };
  const vsVerdict = validateAgainstSchema(schemas.VSFeedResponse!, badVsFeed);
  assert.equal(vsVerdict.ok, false);
  assert.match(vsVerdict.errors.join("; "), /items\[0\]\.creator/);

  // ReasoningFeedResponse: confidenceBps out of 0..10000 range or raw wallet as agentId
  const badReasoning = {
    claimId: 42,
    count: 1,
    items: [
      {
        eventId: "42:agent:pre_stake:0",
        agentId: "agent",
        track: "classic",
        stage: "pre_stake",
        position: "creator",
        confidenceBps: 15_000,
        summary: "Summary",
        uncertainty: "Uncertainty",
        evidence: [],
        beforeStake: true,
        createdAt: 1,
      },
    ],
  };
  const reasoningVerdict = validateAgainstSchema(schemas.ReasoningFeedResponse!, badReasoning);
  assert.equal(reasoningVerdict.ok, false);
  assert.match(reasoningVerdict.errors.join("; "), /confidenceBps: must be <= 10000/);

  // ChallengeOpportunitiesResponse: unknown category or action
  const badOpportunities = {
    items: [
      {
        id: "opp-1",
        sourceUrl: "https://example.com",
        sourceType: "official",
        sourceSummary: "Summary",
        candidate: {
          category: "politics",
          claimText: "Claim",
          sideA: "A",
          sideB: "B",
          deadlineAt: "2026-05-01T00:00:00Z",
          timezone: "UTC",
          primaryResolutionSource: "https://example.com",
          settlementRule: "Rule",
          ambiguityFlags: [],
          confidenceScore: 80,
        },
        claimStrengthScore: 80,
        claimStrengthTier: "strong",
        action: "create",
      },
    ],
    count: 1,
    generatedAt: "2026-05-01T00:00:00Z",
  };
  const oppVerdict = validateAgainstSchema(schemas.ChallengeOpportunitiesResponse!, badOpportunities);
  assert.equal(oppVerdict.ok, false);
  assert.match(oppVerdict.errors.join("; "), /candidate\.category/);

  // PortfolioPerformanceResponse: negative settled count and runtime guard parity
  const badPerformance = {
    points: [{ timestamp: 1000, value: 12.5 }],
    settled: -1,
    cache: {
      source: "index",
      status: "live",
      lastUpdatedAt: null,
      ageMs: 0,
      freshnessWindowMs: 300_000,
    },
  };
  const perfVerdict = validateAgainstSchema(schemas.PortfolioPerformanceResponse!, badPerformance);
  assert.equal(perfVerdict.ok, false);
  assert.equal(isPortfolioPerformanceResponse(badPerformance), false);

  // BasketsListResponse: extra unexpected property
  const badBaskets = {
    baskets: [],
    extraField: true,
  };
  const basketsVerdict = validateAgainstSchema(schemas.BasketsListResponse!, badBaskets);
  assert.equal(basketsVerdict.ok, false);
  assert.match(basketsVerdict.errors.join("; "), /unexpected property "extraField"/);

  // HealthProbeResponse: invalid status enum
  const badHealth = {
    status: "degraded",
    alarms: [],
    operationalStatusUrl: "/api/health/status",
  };
  const healthVerdict = validateAgainstSchema(schemas.HealthProbeResponse!, badHealth);
  assert.equal(healthVerdict.ok, false);
  assert.match(healthVerdict.errors.join("; "), /status: must be one of/);

  // Unsupported keyword throws JsonSchemaError
  assert.throws(
    () => validateAgainstSchema({ ...schemas.BasketsListResponse, $ref: "#/components/schemas/StoredBasket" }, { baskets: [] }),
    JsonSchemaError,
  );
});

// ── 3. Drift detection when a route's documented shape changes ───────────────

test("drift check fails when the committed file is missing or modified without regenerating", () => {
  const missingCheck = checkPublicApiArtifacts(() => undefined);
  assert.equal(missingCheck.audit.ok, false);
  assert.ok(codes(missingCheck.audit).includes("ARTIFACT_MISSING"));
  assert.equal(missingCheck.drifted.length, 1);
  assert.equal(missingCheck.drifted[0]!.relativePath, PUBLIC_OPENAPI_RELATIVE);

  const staleCheck = checkPublicApiArtifacts(() => 'openapi: "3.1.0"\n');
  assert.equal(staleCheck.audit.ok, false);
  const driftFindings = staleCheck.audit.findings.filter((item) => item.code === "ARTIFACT_DRIFT");
  assert.equal(driftFindings.length, 1);
  assert.match(driftFindings[0]!.message, /committed \d+ bytes, generated \d+ bytes/);
});

test("a wrong OpenAPI version fails the audit", () => {
  const audit = auditWith((doc) => {
    doc.openapi = "3.0.3";
  });
  assert.equal(audit.ok, false);
  assert.ok(codes(audit).includes("DOC_INVALID_OPENAPI_VERSION"));
});

test("removing a public read path or adding an unknown path fails the audit", () => {
  const missingAudit = auditWith((doc) => {
    delete (doc.paths as Record<string, unknown>)["/api/baskets"];
  });
  assert.equal(missingAudit.ok, false);
  assert.ok(codes(missingAudit).includes("DOC_MISSING_PATH"));

  const unknownAudit = auditWith((doc) => {
    (doc.paths as Record<string, unknown>)["/api/unlisted"] = { get: {} };
  });
  assert.equal(unknownAudit.ok, false);
  assert.ok(codes(unknownAudit).includes("DOC_UNKNOWN_PATH"));
});

test("changing a route's documented cache header or rate-limit metadata without regenerating fails", () => {
  const cacheAudit = auditWith((doc) => {
    getOperation(doc, "/api/vs")["x-mimir-cache-control"] = "no-store";
  });
  assert.equal(cacheAudit.ok, false);
  assert.ok(codes(cacheAudit).includes("DOC_CACHE_HEADER_DRIFT"));

  const rateLimitAudit = auditWith((doc) => {
    getOperation(doc, "/api/vs/{id}")["x-mimir-rate-limit-route"] = "/api/vs/[id]";
  });
  assert.equal(rateLimitAudit.ok, false);
  assert.ok(codes(rateLimitAudit).includes("DOC_RATE_LIMIT_DRIFT"));
});

test("changing a route's path parameter constraints fails the audit", () => {
  const idAudit = auditWith((doc) => {
    const params = getOperation(doc, "/api/vs/{id}").parameters as Record<string, unknown>[];
    const idParam = params.find((p) => p.name === "id")!;
    (idParam.schema as Record<string, unknown>).minimum = 0;
  });
  assert.equal(idAudit.ok, false);
  assert.ok(codes(idAudit).includes("DOC_PARAMETER_DRIFT"));

  const addrAudit = auditWith((doc) => {
    const params = getOperation(doc, "/api/performance/{address}").parameters as Record<string, unknown>[];
    const addrParam = params.find((p) => p.name === "address")!;
    (addrParam.schema as Record<string, unknown>).pattern = "^0x[a-fA-F0-9]{40}$";
  });
  assert.equal(addrAudit.ok, false);
  assert.ok(codes(addrAudit).includes("DOC_PARAMETER_DRIFT"));
});

test("changing a route's response shape so an example no longer matches fails the audit", () => {
  const schemaDriftAudit = auditWith((doc) => {
    const examples = responseExamplesOf(doc, "/api/baskets", "200");
    (examples.basketsList!.value as Record<string, unknown>).baskets = "not-an-array";
  });
  assert.equal(schemaDriftAudit.ok, false);
  assert.ok(codes(schemaDriftAudit).includes("EXAMPLE_SCHEMA_REJECTED"));
});

test("introducing an unsupported JSON Schema keyword into a component schema fails the audit", () => {
  const unsupportedAudit = auditWith((doc) => {
    const schemas = (doc.components as Record<string, Record<string, Record<string, unknown>>>).schemas!;
    schemas.BasketsListResponse!.patternProperties = { "^x-": { type: "string" } };
  });
  assert.equal(unsupportedAudit.ok, false);
  assert.ok(codes(unsupportedAudit).includes("DOC_SCHEMA_UNSUPPORTED"));
});

test("error status or retryable drift fails the audit", () => {
  const statusAudit = auditWith((doc) => {
    const examples = responseExamplesOf(doc, "/api/vs", "400");
    examples.invalidLimit!["x-mimir-error-code"] = "not_found";
  });
  assert.equal(statusAudit.ok, false);
  assert.ok(codes(statusAudit).includes("ERROR_STATUS_DRIFT"));

  const retryableAudit = auditWith((doc) => {
    const examples = responseExamplesOf(doc, "/api/vs", "429");
    const err = (examples.rateLimited!.value as Record<string, Record<string, unknown>>).error!;
    err.retryable = false;
  });
  assert.equal(retryableAudit.ok, false);
  assert.ok(codes(retryableAudit).includes("ERROR_RETRYABLE_DRIFT"));
});

test("leaking a non-synthetic wallet or secret seed fails without echoing the value", () => {
  const realWallet = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const walletAudit = auditWith((doc) => {
    (doc.info as Record<string, unknown>).description = `wallet ${realWallet}`;
  });
  assert.equal(walletAudit.ok, false);
  assert.ok(codes(walletAudit).includes("PLACEHOLDER_WALLET_UNKNOWN"));
  for (const item of walletAudit.findings) {
    assert.equal(JSON.stringify(item).includes(realWallet), false);
    assert.equal(JSON.stringify(item).includes(SYNTHETIC_WALLETS.owner), false);
  }
});
