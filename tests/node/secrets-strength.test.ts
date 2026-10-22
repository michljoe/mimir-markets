import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  MIN_SECRET_LENGTH,
  WeakSecretError,
  assertStrongSecret,
  inspectSecret,
  resetSecretWarnings,
} from "../../lib/ops/secrets";
import { issuePass, verifyPass } from "../../lib/paid-pass";
import { authorizeRequest } from "../../lib/api/policy";
import { resetRateLimits, type LimitRule } from "../../lib/api/rate-limit";

const STRONG = "f3a9c17e5b2d84a6f0c3e91b7d5482af";

const LOOSE: LimitRule[] = [
  { dimension: "ip", limit: 1_000, windowMs: 60_000 },
  { dimension: "wallet", limit: 1_000, windowMs: 60_000 },
  { dimension: "agent", limit: 1_000, windowMs: 60_000 },
  { dimension: "route", limit: 1_000, windowMs: 60_000 },
];

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}

function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeEach(() => {
  resetRateLimits();
  resetSecretWarnings();
});

// ── The classifier ────────────────────────────────────────────────────────────

test("a random value of the minimum length is accepted", () => {
  assert.equal(STRONG.length, MIN_SECRET_LENGTH);
  assert.deepEqual(inspectSecret(STRONG), { ok: true, length: MIN_SECRET_LENGTH });
});

test("a value one character too short is refused", () => {
  const result = inspectSecret(STRONG.slice(0, -1));
  assert.equal(result.ok, false);
  assert.equal(result.problem, "too_short");
  assert.equal(result.length, MIN_SECRET_LENGTH - 1);
});

test("missing and blank values are refused rather than treated as empty-ok", () => {
  for (const value of [undefined, null, "", "   "]) {
    const result = inspectSecret(value);
    assert.equal(result.ok, false, String(value));
    assert.equal(result.problem, "missing");
  }
});

test("known placeholders are refused at any length", () => {
  // `test` is short but is refused for being a placeholder, not merely short:
  // the message an operator sees should tell them what to change.
  assert.equal(inspectSecret("test").problem, "too_short");
  assert.equal(inspectSecret("mimir-ci-coverage-test").problem, "too_short");
  // Padded to 32+ it passes the length check and must still be refused.
  const padded = "changeme".repeat(4);
  assert.equal(padded.length >= MIN_SECRET_LENGTH, true);
  assert.equal(inspectSecret(padded).problem, "placeholder");
  assert.equal(inspectSecret("test".repeat(8)).problem, "placeholder");
});

test("placeholder matching ignores case and separators", () => {
  assert.equal(inspectSecret("Change-Me".repeat(4)).problem, "placeholder");
  assert.equal(inspectSecret("YOUR-SECRET-YOUR-SECRET-YOUR-SECRET!!").problem, "placeholder");
});

test("a real secret containing a placeholder word is not rejected", () => {
  const value = "9f2atest4c71e0b38d6a5f2e9c4b7a1d";
  assert.equal(value.length >= MIN_SECRET_LENGTH, true);
  assert.equal(inspectSecret(value).ok, true);
});

// ── The assertion ─────────────────────────────────────────────────────────────

test("production refuses a short secret with an error naming the variable", () => {
  const error = captureError(() =>
    assertStrongSecret("CRON_SECRET", "test", {
      env: { NODE_ENV: "production" },
    }),
  );
  assert.ok(error instanceof WeakSecretError);
  assert.equal(error.variable, "CRON_SECRET");
  assert.equal(error.problem, "too_short");
  assert.match(error.message, /CRON_SECRET/);
  assert.match(error.message, /32 characters/);
  // The value is not echoed, even though this particular one is harmless.
  assert.equal(error.message.includes("test"), false);
});

test("production refuses a missing secret", () => {
  const error = captureError(() =>
    assertStrongSecret("PASS_SECRET", undefined, { env: { NODE_ENV: "production" } }),
  );
  assert.ok(error instanceof WeakSecretError);
  assert.equal(error.problem, "missing");
  assert.match(error.message, /PASS_SECRET is not set/);
});

test("production refuses a padded placeholder", () => {
  assert.throws(
    () => assertStrongSecret("PASS_SECRET", "changeme".repeat(4), { env: { NODE_ENV: "production" } }),
    /PASS_SECRET is a known placeholder/,
  );
});

test("production accepts a strong secret", () => {
  assert.doesNotThrow(() =>
    assertStrongSecret("PASS_SECRET", STRONG, { env: { NODE_ENV: "production" } }),
  );
});

test("outside production a weak secret only warns, once", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  assert.doesNotThrow(() =>
    assertStrongSecret("CRON_SECRET", "test", { env: { NODE_ENV: "test" }, warn }),
  );
  assert.doesNotThrow(() =>
    assertStrongSecret("CRON_SECRET", "test", { env: { NODE_ENV: "test" }, warn }),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CRON_SECRET/);
  assert.match(warnings[0], /not production/);
});

test("the warn-once memory can be reset", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  assertStrongSecret("CRON_SECRET", "test", { env: {}, warn });
  resetSecretWarnings();
  assertStrongSecret("CRON_SECRET", "test", { env: {}, warn });
  assert.equal(warnings.length, 2);
});

// ── Call site: PASS_SECRET (council passes) ───────────────────────────────────

test("PASS_SECRET is enforced in production", () => {
  withEnv({ NODE_ENV: "production", PASS_SECRET: "test" }, () => {
    assert.throws(() => issuePass("GABC", "council", 60_000), (error: unknown) => {
      assert.ok(error instanceof WeakSecretError);
      assert.match(error.message, /PASS_SECRET/);
      return true;
    });
    assert.throws(() => verifyPass("anything.signature", "council"), /PASS_SECRET/);
  });
});

test("PASS_SECRET keeps working with a short value outside production", () => {
  withEnv({ NODE_ENV: "test", PASS_SECRET: "test" }, () => {
    const { pass, expiresAt } = issuePass("GABC", "council", 60_000);
    assert.ok(expiresAt > Date.now());
    assert.deepEqual(verifyPass(pass, "council"), {
      payer: "GABC",
      plan: "council",
      exp: expiresAt,
    });
  });
});

// ── Call site: CRON_SECRET (internal worker tier) ─────────────────────────────

test("the worker tier refuses a weak CRON_SECRET in production, naming it", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    const result = authorizeRequest(
      "internal_worker",
      {
        route: "/api/cron/sync",
        presentedSecret: "test",
        expectedSecret: "test",
      },
      LOOSE,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.error?.status, 403);
    assert.equal(result.error?.body.error.code, "forbidden");
    assert.match(result.error?.body.error.message ?? "", /CRON_SECRET/);
    assert.equal((result.error?.body.error.message ?? "").includes("test"), false);
  });
});

test("the worker tier keeps accepting a short CRON_SECRET outside production", () => {
  withEnv({ NODE_ENV: "test" }, () => {
    const result = authorizeRequest(
      "internal_worker",
      {
        route: "/api/cron/sync",
        presentedSecret: "mimir-ci-coverage-test",
        expectedSecret: "mimir-ci-coverage-test",
      },
      LOOSE,
    );
    // This test is about the strength gate only. A refusal further down the
    // pipeline (rate limiting, for example) must not be mistaken for a weak-secret
    // refusal; api-policy.test.ts covers those gates on their own.
    assert.notEqual(result.error?.body.error.code, "forbidden");
    assert.equal((result.error?.body.error.message ?? "").includes("CRON_SECRET"), false);
  });
});

test("a strong CRON_SECRET passes the strength gate in production", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    const result = authorizeRequest(
      "internal_worker",
      {
        route: "/api/cron/sync",
        presentedSecret: STRONG,
        expectedSecret: STRONG,
      },
      LOOSE,
    );
    assert.notEqual(result.error?.body.error.code, "forbidden");
  });
});

test("a weak CRON_SECRET still refuses a wrong presented value", () => {
  // Strength validation must not become a bypass: the comparison still runs.
  withEnv({ NODE_ENV: "test" }, () => {
    const result = authorizeRequest(
      "internal_worker",
      {
        route: "/api/cron/sync",
        presentedSecret: "wrong",
        expectedSecret: "mimir-ci-coverage-test",
      },
      LOOSE,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.error?.body.error.code, "unauthenticated");
  });
});
