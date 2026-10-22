/**
 * Council payout-address validation.
 *
 * `/api/council/vote` and `/api/council/reasoning` resolve their x402 `payTo`
 * per request from `COUNCIL_<SLUG>_PUBLIC`. Before this check the only failure
 * mode was a thrown error inside the paywall, so a missing address or — worse —
 * a secret seed pasted into the `_PUBLIC` variable was discovered when somebody
 * tried to pay, and only then.
 *
 * Two rules matter here:
 *
 *  - **A payout address is a public `G…` account, never an `S…` seed.** A seed in
 *    a variable that is read by the web server is a leaked signing key, so it is
 *    classified explicitly rather than lumped in with "malformed".
 *  - **A rejected value is never echoed.** The audit and its reason strings carry
 *    the variable name and a problem code; the value itself can be a secret.
 *
 * A malformed address is not fatal to the whole process: council payments are one
 * capability, and taking down health checks or market settlement because a persona
 * is unfunded would be worse than refusing its quotes. The audit is reported by
 * `/api/health/status`, and the affected routes refuse to quote a 402.
 */

import { listCouncilPersonas } from "../../agents/council/personas";
import { isAccountAddress } from "../stellar";
import { councilPublicEnv } from "../agent-wallets";

export const COUNCIL_PAYOUT_PROBLEMS = ["missing", "secret_seed", "not_account"] as const;
export type CouncilPayoutProblem = (typeof COUNCIL_PAYOUT_PROBLEMS)[number];

export interface CouncilPayoutOk {
  ok: true;
  slug: string;
  variable: string;
  address: string;
}

export interface CouncilPayoutFailure {
  ok: false;
  slug: string;
  variable: string;
  problem: CouncilPayoutProblem;
  /** Operator-facing explanation. Never contains the configured value. */
  reason: string;
}

export type CouncilPayoutResolution = CouncilPayoutOk | CouncilPayoutFailure;

/**
 * A Stellar secret seed, or something that is clearly trying to be one.
 *
 * The exact seed shape is `S` + 55 base32 characters. Values that start with `S`
 * and are long enough to be a key are also treated as seeds: a typo in an actual
 * seed still must not be echoed or used as a `payTo`.
 */
const SECRET_SEED_LIKE = /^S[A-Z2-7]{10,}$/;

/** `.env` values in this repo may carry a trailing ` # comment`. */
function normalizeValue(raw: string | undefined): string {
  return (raw ?? "").split(/\s+#/)[0].trim();
}

function failure(
  slug: string,
  variable: string,
  problem: CouncilPayoutProblem,
): CouncilPayoutFailure {
  const reason =
    problem === "missing"
      ? `council persona '${slug}' has no payout address configured (${variable})`
      : problem === "secret_seed"
        ? `council persona '${slug}' payout address is a secret seed, not a public account (${variable}); refusing to use it`
        : `council persona '${slug}' payout address is not a Stellar account (${variable})`;
  return { ok: false, slug, variable, problem, reason };
}

/**
 * Resolve one voting persona's payout address.
 *
 * `missing` and `not_account` are configuration errors; `secret_seed` is a
 * security incident — the variable held signing material and should be rotated
 * and removed from wherever it leaked. None of the three ever includes the value.
 */
export function resolveCouncilPayout(
  slug: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CouncilPayoutResolution {
  const normalized = slug.toLowerCase().trim();
  const variable = councilPublicEnv(normalized);
  const value = normalizeValue(env[variable]);

  if (!value) return failure(normalized, variable, "missing");
  if (SECRET_SEED_LIKE.test(value)) return failure(normalized, variable, "secret_seed");
  if (!isAccountAddress(value)) return failure(normalized, variable, "not_account");
  return { ok: true, slug: normalized, variable, address: value };
}

/** Personas that actually vote on settlement (the ones with a prompt bias). */
export function votingPersonas(): Array<{ slug: string }> {
  return listCouncilPersonas()
    .filter((persona) => persona.promptBias !== undefined)
    .map((persona) => ({ slug: persona.slug }));
}

export interface CouncilPayoutProblemEntry {
  persona: string;
  variable: string;
  problem: CouncilPayoutProblem;
}

export interface CouncilPayoutAudit {
  ok: boolean;
  /** Number of voting personas inspected. */
  votingPersonas: number;
  /** How many of them resolve to a usable `G…` account. */
  configured: number;
  /** One entry per bad persona. Contains no addresses or values. */
  problems: CouncilPayoutProblemEntry[];
}

/**
 * Validate every voting persona's payout address without touching the chain.
 *
 * Pure over the environment, so the health endpoint and tests use the same code
 * path. Values are deliberately absent from the result: this ends up on a public,
 * unauthenticated status surface.
 */
export function auditCouncilPayouts(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CouncilPayoutAudit {
  const personas = votingPersonas();
  const problems: CouncilPayoutProblemEntry[] = [];

  for (const persona of personas) {
    const resolution = resolveCouncilPayout(persona.slug, env);
    if (!resolution.ok) {
      problems.push({
        persona: resolution.slug,
        variable: resolution.variable,
        problem: resolution.problem,
      });
    }
  }

  return {
    ok: problems.length === 0,
    votingPersonas: personas.length,
    configured: personas.length - problems.length,
    problems,
  };
}

/**
 * Refusal body for a persona whose quote must not be issued.
 *
 * `null` means the address is usable. Keeping this separate from the HTTP route
 * makes the decision testable and keeps the reason text in one place.
 */
export interface CouncilPayoutRefusal {
  status: 503;
  body: {
    error: "payment_recipient_unavailable";
    reason: string;
    variable: string;
  };
}

export function councilPayoutRefusal(
  slug: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CouncilPayoutRefusal | null {
  const resolution = resolveCouncilPayout(slug, env);
  if (resolution.ok) return null;
  return {
    status: 503,
    body: {
      error: "payment_recipient_unavailable",
      reason: resolution.reason,
      variable: resolution.variable,
    },
  };
}

/**
 * Throw when any voting persona has an unusable payout address.
 *
 * For boot-time checks (a deploy script or a worker that sells council reads).
 * The message names every bad variable but never a value.
 */
export function assertCouncilPayoutsConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const audit = auditCouncilPayouts(env);
  if (audit.ok) return;
  const details = audit.problems
    .map((entry) => `${entry.persona} (${entry.variable}: ${entry.problem})`)
    .join(", ");
  throw new Error(`council payout addresses are misconfigured: ${details}`);
}
