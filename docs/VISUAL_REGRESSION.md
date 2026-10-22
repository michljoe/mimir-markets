# Visual Regression Testing

This document describes the Playwright-based visual regression suite that guards the shared UI components against silent visual drift.

## What is covered

The suite renders the following components in key states and captures screenshots that are committed to the repository:

- **@Shared UI components** (`components/ui/*`)
  * Light and dark themes.
  * Default, hover, focus, disabled, and error states where applicable.
- **ArenaCard.ts** — open and resolved states, light and dark.
- **VSCard.tsx** — open and resolved states, light and dark.
- **SettlementReceipt.tsx** — positive and negative settlement results, light and dark.
- **ClaimStrengthCard.tsx** — various claim strength levels, light and dark.

Full-page snapshots are out of scope; only the individual component renderings are captured.

## How it works

1. A dev/test-only fixture route (`/_fixtures/visual-regression`) renders each component in its key states. The route is guarded behind `NODE_ENV !== 'production'` and returns a 404 in production builds, so it is not reachable in production.
2. Playwright loads the fixture route with a fixed viewport (1280 × 720), disabled animations (`reducedMotion: 'reduce'`), and a stable font stack so screenshots are deterministic.
3. Each component state is snapshotted with `expect(page).getByTestId('...').toHaveScreenshot()` and compared against the committed baseline images.

## Running the suite

Run the visual regression tests locally:

```bash
npm run test:visual
```

To run a single spec file:

```bash
npx playwright test tests/visual/components.spec.ts
```

To run in update mode (see below):

```bash
npm run test:visual:update
```

The suite builds the app with a secret-free environment and uses the runner's Chrome, matching the browser smoke setup (`scripts/run-browser-smoke.mjs`).

## Updating snapshots

When a change intentionally alters the visual appearance of a component, regenerate the baseline images and commit them alongside the code change:

```bash
npm run test:visual:update
```

This runs Playwright with `--update-snapshots` and writes the new baselines to `tests/visual/__snapshots__/`. Review the image diffs before committing:

```bash
git status tests/visual/__snapshots__/
git diff --stat tests/visual/__snapshots__/
```

Only commit snapshot changes that are intentional and reviewed. Accidental diffs indicates a regression and should be fixed in the component code instead.

## Stability guarantees

To keep snapshots stable across two consecutive CI runs, the spec enforces:

- Fixed viewport (1280 × 720) and device scale factor of 1.
- `reducedMotion: 'reduce'` to disable animations and transitions.
- A fixed font stack and font size so text rendering is deterministic.
- Disabled caret blinking and stabilized date/time values in fixture data.
- `fullPage: false` and per-component locators so only the component under test is captured.

If a snapshot is flaky in CI, add a stable wait (e.g. `waitForLoadState('networkidle')` and explicit font readiness) rather than relaxing the comparison threshold.

## Production safety

The fixture route is only registered when `NODE_ENV !== 'production'`. In production builds the route is not added to the router and requests to it return 404. The acceptance criterion is verified by a test that asserts the route is unreachable in a production build.

## Adding a new component to the suite

1. Add the component and its key states to the fixture page, giving each rendered state a unique `testid`.
2. Add a steady `toHaveScreenshot` assertion in `tests/visual/components.spec.ts` targeting that `testid`.
3. Run `npm run test:visual:update` to create the new baseline, review it, and commit it with the component change.

## Files involved

- `tests/visual/components.spec.ts` — Playwright spec with `toHaveScreenshot` assertions.
- `tests/visual/__snapshots__/` — committed baseline images.
- The dev/test-only fixture route rendering each component in key states.
- `package.json` — `test:visual` and `test:visual:update` scripts.
