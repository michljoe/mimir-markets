/**
 * Shared-secret strength checks.
 *
 * `PASS_SECRET` signs council passes and `CRON_SECRET` authorises the internal
 * worker tier (proposal review, cron sync, nonce prune). Both are HMAC/bearer
 * credentials: whoever knows one can mint passes or drive privileged jobs. A
 * value like `test` is fine on a laptop and a full compromise in production.
 *
 * The rule is deliberately narrow — length plus a placeholder list — because a
 * real entropy check would reject perfectly good random hex that happens to be
 * short (or accept a long phrase an attacker can guess). It is not a password
 * policy; it is a guard against the specific mistake of shipping the value from
 * `.env.example` or CI.
 *
 * Enforcement follows the environment:
 *
 *   NODE_ENV=production  → throw {@link WeakSecretError}, naming the variable
 *   anything else        → warn once, then continue (tests and `next dev` keep
 *                          working with short values)
 *
 * The value itself never appears in a message. An error is logged by the same
 * process that holds the secret, but logs travel further than the process.
 */

export const MIN_SECRET_LENGTH = 32;

/**
 * Values that are obviously not secrets, whatever their length.
 *
 * Matched case-insensitively, and also with separators removed, so
 * `change-me`, `CHANGE_ME` and `ChangeMe` are one entry. `mimir-ci-coverage-test`
 * is the value CI uses today; it is short enough to fail the length check too,
 * but listing it makes the intent explicit.
 */
const PLACEHOLDER_SECRETS = new Set([
  "test",
  "tests",
  "testing",
  "ci",
  "ci-test",
  "ci-secret",
  "ci-test-secret",
  "mimir-ci-coverage-test",
  "secret",
  "shared-secret",
  "changeme",
  "change-me",
  "replace-me",
  "password",
  "pass",
  "dev",
  "development",
  "local",
  "localhost",
  "example",
  "sample",
  "placeholder",
  "dummy",
  "default",
  "not-a-secret",
  "your-secret",
  "your-secret-here",
]);

/**
 * Placeholders that were padded to look long enough: `test-test-test-…`,
 * `changeme-changeme-…`, `your-secret-your-secret-…`.
 */
function isPaddedPlaceholder(compact: string): boolean {
  for (const placeholder of PLACEHOLDER_SECRETS) {
    const unit = placeholder.replace(/[^a-z0-9]/g, "");
    // Short units (`ci`, `dev`) would match too much; a repeated longer word is
    // the shape we care about.
    if (unit.length < 4 || compact.length % unit.length !== 0) continue;
    if (unit.repeat(compact.length / unit.length) === compact) return true;
  }
  return false;
}

export type SecretProblem = "missing" | "too_short" | "placeholder";

export interface SecretInspection {
  ok: boolean;
  problem?: SecretProblem;
  /** Length after trimming, so a message can be useful without echoing a value. */
  length: number;
}

/** Classify a candidate secret without throwing and without echoing it. */
export function inspectSecret(value: string | undefined | null): SecretInspection {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { ok: false, problem: "missing", length: 0 };
  if (trimmed.length < MIN_SECRET_LENGTH) {
    return { ok: false, problem: "too_short", length: trimmed.length };
  }
  const normalized = trimmed.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (PLACEHOLDER_SECRETS.has(normalized) || PLACEHOLDER_SECRETS.has(compact)) {
    return { ok: false, problem: "placeholder", length: trimmed.length };
  }
  if (isPaddedPlaceholder(compact)) {
    return { ok: false, problem: "placeholder", length: trimmed.length };
  }
  return { ok: true, length: trimmed.length };
}

/** A secret that cannot be used in production. Carries no secret value. */
export class WeakSecretError extends Error {
  readonly variable: string;
  readonly problem: SecretProblem;

  constructor(variable: string, problem: SecretProblem, message: string) {
    super(message);
    this.name = "WeakSecretError";
    this.variable = variable;
    this.problem = problem;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Explain a failed check by name and shape only — never by value. */
export function describeSecretProblem(
  name: string,
  inspection: SecretInspection,
): string {
  switch (inspection.problem) {
    case "missing":
      return `${name} is not set`;
    case "too_short":
      return `${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${inspection.length})`;
    case "placeholder":
      return `${name} is a known placeholder and must be replaced with a random value of at least ${MIN_SECRET_LENGTH} characters`;
    default:
      return `${name} is not a strong secret`;
  }
}

export interface AssertStrongSecretOptions {
  /** Environment to read NODE_ENV from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Warn sink. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

const warned = new Set<string>();

/** Clear the warn-once memory. Tests use this between cases. */
export function resetSecretWarnings(): void {
  warned.clear();
}

/**
 * Refuse a weak shared secret in production; warn about it everywhere else.
 *
 * Throws {@link WeakSecretError} when `NODE_ENV === "production"` and the value
 * is missing, shorter than {@link MIN_SECRET_LENGTH}, or a known placeholder.
 * Outside production it warns once per variable/problem pair so a dev server or
 * a test run with `CRON_SECRET=test` keeps working without flooding the log.
 */
export function assertStrongSecret(
  name: string,
  value: string | undefined | null,
  options: AssertStrongSecretOptions = {},
): void {
  const env = options.env ?? process.env;
  const inspection = inspectSecret(value);
  if (inspection.ok) return;

  const detail = describeSecretProblem(name, inspection);
  if (env.NODE_ENV === "production") {
    throw new WeakSecretError(name, inspection.problem ?? "missing", detail);
  }

  const key = `${name}:${inspection.problem}`;
  if (warned.has(key)) return;
  warned.add(key);
  (options.warn ?? console.warn)(
    `[secrets] ${detail}; allowed because NODE_ENV is not production`,
  );
}
