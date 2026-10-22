/**
 * tests/node/council-pass-ttl.test.ts
 *
 * Regression coverage for the council pass lifetime (#519).
 *
 * `COUNCIL_PASS_TTL_MS` is operator-supplied, so a typo (`10m`), a blank value,
 * a fraction or a negative number must never reach `issuePass()`:
 *
 *   - a typo produced `NaN`, and that `NaN` was echoed back to the buyer as
 *     `ttlMs: NaN` / `expiresAt: NaN` — *after* the payment had been taken;
 *   - a negative value issued an already-expired pass.
 *
 * The policy lives in `lib/council/pass-ttl.ts` (pure, table-driven below) and
 * the route wiring is asserted at source level, because the node suite has no
 * Next.js request/paywall context to drive `POST /api/council/subscribe`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_COUNCIL_PASS_TTL_MS,
  MAX_COUNCIL_PASS_TTL_MS,
  resolveCouncilPassTtlMs,
} from "../../lib/council/pass-ttl";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const route = read("app/api/council/subscribe/route.ts");

/* ── Policy constants ───────────────────────────────────────────────────────── */

test("the default council pass lifetime is 10 minutes", () => {
  assert.equal(DEFAULT_COUNCIL_PASS_TTL_MS, 600_000);
});

test("the council pass lifetime is capped at 24 hours", () => {
  assert.equal(MAX_COUNCIL_PASS_TTL_MS, 86_400_000);
});

/* ── Table-driven resolution ────────────────────────────────────────────────── */

const CASES: Array<{ raw: unknown; expected: number; why: string }> = [
  { raw: undefined, expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "unset" },
  { raw: "", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "empty" },
  { raw: "   ", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "blank" },
  { raw: "abc", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "not a number" },
  { raw: "10m", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "duration typo" },
  { raw: "-5", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "negative" },
  { raw: "0", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "zero" },
  { raw: "1.5", expected: DEFAULT_COUNCIL_PASS_TTL_MS, why: "not an integer" },
  { raw: "600000", expected: 600_000, why: "valid" },
  { raw: " 900000 ", expected: 900_000, why: "valid with padding" },
  { raw: 600_000, expected: 600_000, why: "valid number" },
  { raw: "999999999", expected: MAX_COUNCIL_PASS_TTL_MS, why: "over the cap" },
];

for (const { raw, expected, why } of CASES) {
  test(`resolveCouncilPassTtlMs: ${why} → ${expected}`, () => {
    assert.equal(resolveCouncilPassTtlMs(raw), expected);
  });
}

test("a malformed value never yields NaN, 0 or a negative lifetime", () => {
  for (const { raw } of CASES) {
    const ttl = resolveCouncilPassTtlMs(raw);
    assert.equal(Number.isFinite(ttl), true, `${String(raw)} must not resolve to NaN`);
    assert.equal(Number.isInteger(ttl), true, `${String(raw)} must resolve to an integer`);
    assert.ok(ttl > 0, `${String(raw)} must resolve to a positive lifetime`);
  }
});

test("the resolved lifetime always produces a finite expiry", () => {
  for (const { raw } of CASES) {
    const expiresAt = Date.now() + resolveCouncilPassTtlMs(raw);
    assert.equal(Number.isFinite(expiresAt), true, `${String(raw)} must not produce a NaN expiry`);
  }
});

test("a valid lifetime is never rewritten", () => {
  // Everything below the cap has to survive untouched — the helper is a
  // guard, not a rounding policy.
  for (const value of [1, 1_000, 600_000, 3_600_000, MAX_COUNCIL_PASS_TTL_MS]) {
    assert.equal(resolveCouncilPassTtlMs(String(value)), value);
  }
});

/* ── Route wiring ──────────────────────────────────────────────────────────── */

test("the route resolves the lifetime through the shared helper", () => {
  assert.match(route, /const ttlMs = resolveCouncilPassTtlMs\(/);
});

test("the route no longer casts the env value straight into Number()", () => {
  // Before: `Number(process.env.COUNCIL_PASS_TTL_MS ?? 10 * 60 * 1000)`.
  assert.equal(/Number\(\s*process\.env\.COUNCIL_PASS_TTL_MS/.test(route), false);
});

test("the route issues the pass with the lifetime it reports", () => {
  assert.match(route, /issuePass\(payer, PLAN, ttlMs\)/);
  assert.match(route, /expiresAt,\s*\n\s*ttlMs,/);
});

test("the route imports the helper from the council policy module", () => {
  assert.match(route, /import \{ resolveCouncilPassTtlMs \} from "@\/lib\/council\/pass-ttl"/);
});
