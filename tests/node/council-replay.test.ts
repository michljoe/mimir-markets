import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { loadLedgerFixture } from "../../lib/ops/ledger-fixture";
import { runPersona } from "../../agents/council/shared/persona-runner";
import type { PersonaRunnerContext } from "../../agents/council/shared/persona-runner";
import { RULE_PERSONAS } from "../../agents/council/shared/persona-rules";

const ROOT = join(__dirname, "..", "..");
const FIXTURE_PATH = join(ROOT, "fixtures", "ledger", "funded-market-v1.json");
const EXPECTED_PATH = join(ROOT, "tests", "fixtures", "council-replay-expected.json");

type DecisionSnapshot = {
  persona: string;
  decision: "stake" | "skip";
  reason: string;
};

const STUB_LLM_RESPONSES = {
  "bull-case": "stake",
  "bear-case": "skip",
  "neutral-case": "skip",
} as const;

function buildStubbedLlm() {
  return async (prompt: string): Promise<string> => {
    const match = prompt.match(/persona:([a-z0-9-]+)/i);
    const key = match?.[1] ?? "neutral-case";
    const decision = STUB_LLM_RESPONSES[key as keyof typeof STUB_LLM_RESPONSES] ?? "skip";
    return JSON.stringify({ decision, reason: `stubbed llm decision for ${key}` });
  };
}

function normalize(decisions: DecisionSnapshot[]): DecisionSnapshot[] {
  return [...decisions].sort((a, b) => a.persona.localeCompare(b.persona));
}

describe("council replay against funded-market ledger fixture", () => {
  it("runs offline and matches committed decision snapshot", async () => {
    const fixture = await loadLedgerFixture(FIXTURE_PATH);
    const context: PersonaRunnerContext = {
      claimOnChain: fixture.claimOnChain,
      llm: buildStubbedLlm(),
    };

    const decisions: DecisionSnapshot[] = [];
    for (const persona of RULE_PERSONAS) {
      const result = await runPersonic(persona.name, context);
      decisions.push({
        persona: persona.name,
        decision: result.decision,
        reason: result.reason,
      });
    }

    const actual = normalize(decisions);

    if (!existsSync(EXPECTED_PATH)) {
      writeFileSync(EXPECTED_PATH, JSON.stringify(actual, null, 2) + "\n");
      assert.fail(`expected snapshot missing; wrote ${EXPECTED_PATH} - review and commit`);
    }

    const expected = JSON.parse(readFileSync(EXPECTED_PATH, "utf-8")) as DecisionSnapshot[];
    assert.deepEqual(actual, normalize(expected));
  });
});
