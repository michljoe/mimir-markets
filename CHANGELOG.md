# Changelog

All notable changes to Mimir are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries describe the
why, the commit history records the what.

## [Unreleased]

### Fixed

- **The Oracle Reasoning Trace disclosure now announces its state** ([#522](https://github.com/mimir-stellar/mimir-markets/issues/522)). The `EvidenceInspector` toggle button carried no `aria-expanded` and no `aria-controls`, the expanded panel had no id and no label, and the chevron icons were read out as content — so screen-reader users could not tell whether the panel was open, nor which region the button controlled. The button now exposes `aria-expanded` / `aria-controls` (paired through `useId`), the panel is a labelled `region`, the chevrons are `aria-hidden`, and the toggle keeps a visible focus ring.
- **Council passes no longer ship a `NaN` lifetime** ([#519](https://github.com/mimir-stellar/mimir-markets/issues/519)). `COUNCIL_PASS_TTL_MS` was cast straight into `Number()`, so a typo (`10m`), a blank value, a fraction or a negative number flowed into `issuePass()` and back to the buyer as `ttlMs: NaN` / `expiresAt: NaN` *after* the payment had been taken — and a negative value issued an already-expired pass. The lifetime now resolves through `resolveCouncilPassTtlMs()` (`lib/council/pass-ttl.ts`): malformed values fall back to the 10-minute default, values above the cap are clamped to 24 hours, and the TTL the route reports is exactly the one the pass was issued with.

### Changed

- **CI path filters now fail closed** ([#127](https://github.com/mimir-stellar/mimir-markets/issues/127), [#168](https://github.com/mimir-stellar/mimir-markets/pull/168)). CI selects what to run from an allowlist of changed paths instead of one monolithic job: a changed path either maps to a tier (`app`, `agents`, `contracts`, `tests`) and runs that tier's checks, or it matches nothing and is UNKNOWN — and UNKNOWN fails the build. Filters that fail open are worse than none at all: they turn a green check into a lie about what was verified. Every degenerate case therefore resolves to "run more", never "run less":
  - An unclassified path (new top-level directory, unlisted root file, near-miss like `appx/`) fails the paths job and runs all tiers.
  - An undecidable change set (missing event payload, failed fetch, no merge-base) runs all tiers and marks the run red.
  - Doc-only changes (`README.md`, `CHANGELOG.md`, `LICENSE`, `docs/`) are the one explicit "run nothing" outcome.
- Adding a scope is now a reviewed, parity-checked decision: `lib/ci/path-scope.ts` (the tested contract) and `scripts/ci/changed-paths.mjs` (the workflow driver) must stay identical, enforced by `npm run check:driver-parity` and `tests/node/ci-path-scope.test.ts`. A green CI run now means the suites that ran are exactly the suites the change required.
