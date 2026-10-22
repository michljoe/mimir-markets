import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { listCouncilPersonas } from "../../agents/council/personas";
import { PHILOSOPHER_PERSONAS } from "../../agents/council/philosophers";
import { councilPublicEnv, councilSecretEnv } from "../../lib/agent-wallets";

const COUNCIL_DOC = readFileSync(join(process.cwd(), "docs", "COUNCIL.md"), "utf8");

test("every persona slug from classic and philosopher rosters appears in docs/COUNCIL.md", () => {
  const classic = listCouncilPersonas();
  const philosophers = PHILOSOPHER_PERSONAS;

  assert.ok(classic.length > 0, "must have classic personas");
  assert.ok(philosophers.length > 0, "must have philosopher personas");

  const allPersonas = [...classic, ...philosophers];
  const allSlugs = new Set<string>();

  for (const persona of allPersonas) {
    assert.equal(
      allSlugs.has(persona.slug),
      false,
      `Persona slug "${persona.slug}" is duplicated across persona files`,
    );
    allSlugs.add(persona.slug);

    // Assert persona slug is in docs/COUNCIL.md
    assert.ok(
      COUNCIL_DOC.includes(`\`${persona.slug}\``),
      `Expected persona slug "${persona.slug}" to appear in docs/COUNCIL.md`,
    );

    // Assert corresponding secret and public env var names are in docs/COUNCIL.md
    const secretEnv = councilSecretEnv(persona.slug);
    const publicEnv = councilPublicEnv(persona.slug);

    assert.ok(
      COUNCIL_DOC.includes(`\`${secretEnv}\``),
      `Expected secret env var "${secretEnv}" to appear in docs/COUNCIL.md`,
    );
    assert.ok(
      COUNCIL_DOC.includes(`\`${publicEnv}\``),
      `Expected public env var "${publicEnv}" to appear in docs/COUNCIL.md`,
    );
  }

  assert.equal(allSlugs.size, 20, "expected 20 unique persona slugs across both files");
});

test("docs/COUNCIL.md documents COUNCIL_PHILOSOPHERS=0 to disable philosophers", () => {
  assert.ok(
    COUNCIL_DOC.includes("COUNCIL_PHILOSOPHERS=0"),
    "Expected docs/COUNCIL.md to mention COUNCIL_PHILOSOPHERS=0",
  );
});

test("docs/COUNCIL.md documents rule-based vs LLM-based personas", () => {
  assert.ok(
    COUNCIL_DOC.includes("contrarian") && COUNCIL_DOC.includes("whale-watcher"),
    "Expected contrarian and whale-watcher to be documented",
  );
  assert.match(
    COUNCIL_DOC,
    /contrarian.*Rule-based/i,
    "Expected contrarian to be marked as Rule-based",
  );
  assert.match(
    COUNCIL_DOC,
    /whale-watcher.*Rule-based/i,
    "Expected whale-watcher to be marked as Rule-based",
  );
});
