import assert from "node:assert/strict";
import test from "node:test";

import { createLLMRouter } from "../../lib/llm/router";

function makeRouter(nowValue: { current: number }) {
  return createLLMRouter({
    now: () => nowValue.current,
    cooldowns: {
      gemini: 5_000,
      groq: 10_000,
      openrouter: 7_000,
    },
    providers: [
      { id: "openrouter", enabled: () => true },
      { id: "groq", keys: () => ["groq-a", "groq-b"], enabled: () => true },
      { id: "gemini", keys: () => ["gemini-a"], models: () => ["gemini-model-a", "gemini-model-b"], enabled: () => true },
      { id: "anthropic", enabled: () => false },
    ],
  });
}

test("quota error trips the right cooldown", () => {
  const nowValue = { current: 1_000 };
  const router = makeRouter(nowValue);

  router.tripCooldown("gemini", "gemini-a", "gemini-model-a");
  router.tripCooldown("groq", "groq-a");
  router.tripCooldown("openrouter");

  assert.equal(router.providerCooldown("gemini", "gemini-a", "gemini-model-a"), 5_000);
  assert.equal(router.providerCooldown("groq", "groq-a"), 10_000);
  assert.equal(router.providerCooldown("openrouter"), 7_000);
});

test("fallback skips cooled-down providers", () => {
  const nowValue = { current: 1_000 };
  const router = makeRouter(nowValue);

  router.tripCooldown("openrouter");
  router.tripCooldown("gemini", "gemini-a", "gemini-model-a");
  assert.deepEqual(router.fallbackProviders("openrouter"), ["groq", "gemini"]);
  assert.equal(router.chooseNext("openrouter")?.provider, "groq");
});

test("Groq rotates through available keys", () => {
  const nowValue = { current: 1_000 };
  const router = makeRouter(nowValue);

  router.tripCooldown("groq", "groq-a");
  const next = router.chooseNext("groq");

  assert.ok(next);
  assert.equal(next.provider, "groq");
  assert.equal(next.key, "groq-b");
});

test("all cooled-down yields a descriptive error", () => {
  const nowValue = { current: 1_000 };
  const router = makeRouter(nowValue);

  router.tripCooldown("openrouter");
  router.tripCooldown("groq", "groq-a");
  router.tripCooldown("groq", "groq-b");
  router.tripCooldown("gemini", "gemini-a", "gemini-model-a");
  router.tripCooldown("gemini", "gemini-a", "gemini-model-b");

  const result = router.chooseNext("openrouter");
  assert.equal(result, null);
  assert.match(router.allCooledDownMessage("openrouter"), /all configured LLM providers .* cooldown/i);
});

test("cooldown expiry restores a provider", () => {
  const nowValue = { current: 1_000 };
  const router = makeRouter(nowValue);

  router.tripCooldown("openrouter");
  nowValue.current = 8_001;

  assert.equal(router.providerCooldown("openrouter"), 0);
  assert.equal(router.chooseNext("openrouter")?.provider, "openrouter");
});
