import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import {
  assertCouncilPayoutsConfigured,
  auditCouncilPayouts,
  councilPayoutRefusal,
  resolveCouncilPayout,
  votingPersonas,
} from "../../lib/ops/council-payouts";
import { councilPublicEnv } from "../../lib/agent-wallets";
import { evaluateOperationalStatusReport } from "../../lib/ops/operational-status";

const CONTRACT_LIKE = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

function envForVotingPersonas(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const persona of votingPersonas()) {
    env[councilPublicEnv(persona.slug)] = Keypair.random().publicKey();
  }
  return env;
}

// ── One persona ───────────────────────────────────────────────────────────────

test("a valid G... account resolves", () => {
  const address = Keypair.random().publicKey();
  const result = resolveCouncilPayout("optimist", { COUNCIL_OPTIMIST_PUBLIC: address });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.address, address);
  assert.equal(result.variable, "COUNCIL_OPTIMIST_PUBLIC");
});

test("a missing address is reported by variable, naming no value", () => {
  const result = resolveCouncilPayout("optimist", {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.problem, "missing");
  assert.equal(result.variable, "COUNCIL_OPTIMIST_PUBLIC");
  assert.match(result.reason, /COUNCIL_OPTIMIST_PUBLIC/);
});

test("a blank address is missing, not a usable account", () => {
  for (const value of ["", "   ", undefined]) {
    const result = resolveCouncilPayout("optimist", { COUNCIL_OPTIMIST_PUBLIC: value });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.problem, "missing");
  }
});

test("a secret seed in a _PUBLIC variable is flagged and never echoed", () => {
  const seed = Keypair.random().secret();
  const result = resolveCouncilPayout("optimist", { COUNCIL_OPTIMIST_PUBLIC: seed });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.problem, "secret_seed");
  assert.equal(result.reason.includes(seed), false);
  assert.equal(JSON.stringify(result).includes(seed), false);
  // The reason says what to fix without repeating the secret.
  assert.match(result.reason, /secret seed/);
  assert.match(result.reason, /COUNCIL_OPTIMIST_PUBLIC/);
});

test("a contract id is not an account and is refused", () => {
  const result = resolveCouncilPayout("optimist", { COUNCIL_OPTIMIST_PUBLIC: CONTRACT_LIKE });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.problem, "not_account");
  assert.equal(result.reason.includes(CONTRACT_LIKE), false);
});

test("malformed values are refused rather than echoed", () => {
  const result = resolveCouncilPayout("optimist", {
    COUNCIL_OPTIMIST_PUBLIC: "not-an-address",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.problem, "not_account");
  assert.equal(result.reason.includes("not-an-address"), false);
});

test("a trailing .env comment does not invalidate a real address", () => {
  const address = Keypair.random().publicKey();
  const result = resolveCouncilPayout("optimist", {
    COUNCIL_OPTIMIST_PUBLIC: `${address} # payout wallet`,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.address, address);
});

test("slug casing and dashes map to the same variable", () => {
  const address = Keypair.random().publicKey();
  const result = resolveCouncilPayout("Whale-Watcher", {
    COUNCIL_WHALE_WATCHER_PUBLIC: address,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.variable, "COUNCIL_WHALE_WATCHER_PUBLIC");
});

// ── Every voting persona ──────────────────────────────────────────────────────

test("only personas that vote are audited", () => {
  const slugs = votingPersonas().map((persona) => persona.slug);
  assert.ok(slugs.includes("optimist"));
  assert.ok(slugs.includes("statistician"));
  // Rule-based personas use pool dynamics, not evidence, and do not vote.
  assert.equal(slugs.includes("contrarian"), false);
  assert.equal(slugs.includes("whale-watcher"), false);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("a fully configured registry audits clean", () => {
  const env = envForVotingPersonas();
  const audit = auditCouncilPayouts(env);
  assert.equal(audit.ok, true);
  assert.equal(audit.votingPersonas, votingPersonas().length);
  assert.equal(audit.configured, audit.votingPersonas);
  assert.deepEqual(audit.problems, []);
});

test("a missing persona is reported without blocking the rest", () => {
  const env = envForVotingPersonas();
  delete env.COUNCIL_OPTIMIST_PUBLIC;
  const audit = auditCouncilPayouts(env);
  assert.equal(audit.ok, false);
  assert.equal(audit.configured, audit.votingPersonas - 1);
  assert.deepEqual(audit.problems, [
    {
      persona: "optimist",
      variable: "COUNCIL_OPTIMIST_PUBLIC",
      problem: "missing",
    },
  ]);
});

test("the audit never includes configured values", () => {
  const seed = Keypair.random().secret();
  const env = envForVotingPersonas();
  env.COUNCIL_OPTIMIST_PUBLIC = seed;
  const audit = auditCouncilPayouts(env);
  assert.equal(audit.ok, false);
  const leaked = audit.problems.find((entry) => entry.persona === "optimist");
  assert.equal(leaked?.problem, "secret_seed");
  assert.equal(JSON.stringify(audit).includes(seed), false);
  // Valid addresses are not copied into the public audit either.
  for (const value of Object.values(env)) {
    assert.equal(JSON.stringify(audit).includes(value), false);
  }
});

test("assertCouncilPayoutsConfigured fails fast without echoing values", () => {
  const seed = Keypair.random().secret();
  assert.throws(
    () => assertCouncilPayoutsConfigured({ COUNCIL_OPTIMIST_PUBLIC: seed }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /COUNCIL_OPTIMIST_PUBLIC/);
      assert.equal(error.message.includes(seed), false);
      return true;
    },
  );
  assert.doesNotThrow(() => assertCouncilPayoutsConfigured(envForVotingPersonas()));
});

// ── 402 quoting ───────────────────────────────────────────────────────────────

test("a usable persona produces no refusal", () => {
  const address = Keypair.random().publicKey();
  assert.equal(councilPayoutRefusal("optimist", { COUNCIL_OPTIMIST_PUBLIC: address }), null);
});

test("an unusable persona refuses a quote with 503 and a safe reason", () => {
  const seed = Keypair.random().secret();
  const refusal = councilPayoutRefusal("optimist", { COUNCIL_OPTIMIST_PUBLIC: seed });
  assert.ok(refusal);
  assert.equal(refusal?.status, 503);
  assert.equal(refusal?.body.error, "payment_recipient_unavailable");
  assert.match(refusal?.body.reason ?? "", /COUNCIL_OPTIMIST_PUBLIC/);
  assert.equal(refusal?.body.reason.includes(seed), false);
});

// ── Health status integration ────────────────────────────────────────────────

test("health status reports missing payouts without changing the overall status", () => {
  const report = evaluateOperationalStatusReport({
    nowMs: 1_800_000_000_000,
    env: { NODE_ENV: "development", NEXT_PUBLIC_STELLAR_NETWORK: "testnet" },
  });
  // A missing address only blocks that persona's quotes; it is not an outage.
  assert.equal(report.status, "ok");
  assert.equal(report.configuration.councilPayouts.ok, false);
  assert.equal(report.configuration.councilPayouts.configured, 0);
  assert.ok(report.configuration.councilPayouts.problems.length > 0);
});

test("valid payout configuration leaves the health report unchanged", () => {
  const env = {
    NODE_ENV: "development",
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    ...envForVotingPersonas(),
  };
  const report = evaluateOperationalStatusReport({ nowMs: 1_800_000_000_000, env });
  assert.equal(report.status, "ok");
  assert.equal(report.mode, "operational");
  assert.equal(report.configuration.councilPayouts.ok, true);
});

test("a seed in a payout variable degrades health without echoing it", () => {
  const seed = Keypair.random().secret();
  const env: Record<string, string> = {
    NODE_ENV: "development",
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    ...envForVotingPersonas(),
  };
  env.COUNCIL_OPTIMIST_PUBLIC = seed;
  const report = evaluateOperationalStatusReport({ nowMs: 1_800_000_000_000, env });
  assert.equal(report.status, "warn");
  assert.equal(report.mode, "degraded");
  assert.equal(JSON.stringify(report).includes(seed), false);
  assert.ok(
    report.configuration.councilPayouts.problems.some(
      (entry) => entry.persona === "optimist" && entry.problem === "secret_seed",
    ),
  );
});
