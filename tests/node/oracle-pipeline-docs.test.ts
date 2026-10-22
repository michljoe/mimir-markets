import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ORACLE_INDEX = readFileSync(
  join(process.cwd(), "agents", "oracle", "index.ts"),
  "utf8",
);
const ORACLE_PIPELINE_DOC = readFileSync(
  join(process.cwd(), "docs", "ORACLE_PIPELINE.md"),
  "utf8",
);
const INCIDENT_RUNBOOK = readFileSync(
  join(process.cwd(), "docs", "AGENT_INCIDENT_RUNBOOK.md"),
  "utf8",
);

test("docs/ORACLE_PIPELINE.md documents every process.env variable read in agents/oracle/index.ts", () => {
  // Extract all process.env.<VAR> occurrences directly from agents/oracle/index.ts
  const envMatches = Array.from(
    ORACLE_INDEX.matchAll(/process\.env\.([A-Z0-9_]+)/g),
  ).map((m) => m[1]);

  const uniqueEnvVars = Array.from(new Set(envMatches));
  assert.ok(uniqueEnvVars.length > 0, "must find process.env variables in agents/oracle/index.ts");

  for (const envVar of uniqueEnvVars) {
    assert.ok(
      ORACLE_PIPELINE_DOC.includes(`\`${envVar}\``),
      `Expected process.env variable "${envVar}" from agents/oracle/index.ts to be documented in docs/ORACLE_PIPELINE.md`,
    );
  }
});

test("docs/ORACLE_PIPELINE.md documents key environment knobs and startup env vars", () => {
  const startupAndKnobEnvs = [
    "ORACLE_SECRET",
    "NEXT_PUBLIC_STELLAR_MARKET_CONTRACT_ID",
    "ORACLE_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "GROQ_API_KEYS",
    "OPENROUTER_API_KEY",
    "ORACLE_POLL_INTERVAL_MS",
    "ORACLE_LLM_THROTTLE_MS",
    "ORACLE_SETTLEMENT_DELAY_MS",
    "AUTO_CHALLENGE",
    "CHALLENGE_STAKE_USDC",
    "CHALLENGE_CONFIDENCE",
    "PAY_EVIDENCE",
    "EVIDENCE_POOL_BPS",
    "EVIDENCE_MAX_USDC",
    "EVIDENCE_MIN_USDC",
    "SPORTS_SETTLE_GRACE_HOURS",
    "COUNCIL_SETTLEMENT",
    "MIMIR_BASE_URL",
    "COUNCIL_QUORUM",
    "COUNCIL_VOTE_CAP_USDC",
    "COUNCIL_SELF_RESOLVING",
    "COUNCIL_ALPHA",
    "COUNCIL_BONUS_USDC",
    "MIMIR_PAUSE_ORACLE_SETTLEMENT",
    "MIMIR_PAUSE_ALL",
    "ORACLE_SETTLEMENT_TX_MAX_ATTEMPTS",
    "ORACLE_SETTLEMENT_TX_RETRY_BASE_MS",
    "ORACLE_SETTLEMENT_TX_RETRY_MAX_MS",
  ];

  for (const envVar of startupAndKnobEnvs) {
    assert.ok(
      ORACLE_PIPELINE_DOC.includes(`\`${envVar}\``),
      `Expected environment variable "${envVar}" to appear in docs/ORACLE_PIPELINE.md`,
    );
  }
});

test("docs/ORACLE_PIPELINE.md includes a Mermaid sequence diagram matching code order", () => {
  assert.ok(
    ORACLE_PIPELINE_DOC.includes("```mermaid\nsequenceDiagram"),
    "Expected Mermaid sequence diagram in docs/ORACLE_PIPELINE.md",
  );

  const expectedStepsInOrder = [
    "getClaimCount",
    "readClaimsBatch",
    "classifyClaimsForOracle",
    "settle",
    "fetchEvidence",
    "isSportsEventFinal",
    "evidenceCommitmentHash",
    "applyFetcherTrust",
    "applySettlementPolicy",
    "resolveClaim",
  ];

  let lastIndex = -1;
  for (const step of expectedStepsInOrder) {
    const currentIndex = ORACLE_PIPELINE_DOC.indexOf(step);
    assert.ok(
      currentIndex !== -1,
      `Expected step "${step}" to appear in docs/ORACLE_PIPELINE.md`,
    );
    assert.ok(
      currentIndex > lastIndex,
      `Expected step "${step}" to appear in chronological code order after previous step`,
    );
    lastIndex = currentIndex;
  }
});

test("docs/AGENT_INCIDENT_RUNBOOK.md links to docs/ORACLE_PIPELINE.md", () => {
  assert.ok(
    INCIDENT_RUNBOOK.includes("ORACLE_PIPELINE.md"),
    "Expected docs/AGENT_INCIDENT_RUNBOOK.md to link to ORACLE_PIPELINE.md",
  );
});
