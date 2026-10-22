# PR: Emerging Narrative Activity View

**Title**: `feat(emerging-narratives): surface category momentum`

**Status**: Ready for review  
**Date**: 2026-10-18  
**Area**: Emerging narratives, VS cache, explorer

---

## Summary

Replace the `/emerging-narratives` coming-soon placeholder with a server-rendered view of category activity. Ranked cards compare new markets and stake in the most recent seven-day window with the previous seven-day window, show the highest-stake recent markets, and link to both those markets and the category-filtered explorer.

The page needs no connected wallet. Empty data, stale index data, and index failures have dedicated UI states.

## Changes

### Activity aggregation

**File**: `lib/emerging-narratives.ts`

- Computes activity across the recent and previous seven-day windows.
- Assigns the recent-window start boundary to the recent window and the previous-window start boundary to the previous window; excludes future-dated and older markets.
- Excludes cancelled markets and normalizes legacy or unknown category ids through `normalizeCategoryId`.
- Converts USDC stakes to seven-decimal atomic units and sums/ranks them with `bigint` arithmetic.
- Scores category momentum as the average of market-count growth and stake growth, expressed in basis points. A positive value with a zero previous baseline is bounded at 100%; a zero-to-zero comparison scores zero.
- Uses deterministic category and market tie-breaks. Recent markets are ranked by stake, then creation time, then id.

### Server data and page

**Files**: `app/[locale]/emerging-narratives/page.tsx`, `lib/server/vs-cache.ts`

- Reads cached VS rows and their sync timestamp server-side; the cache API continues to serve the existing `getAllVSFast()` callers.
- Request-renders the page and passes serializable aggregation results and freshness metadata to the view.
- Shows ranked category cards with recent/previous market counts and stake, top recent markets, explorer filters, and locale-aware market links.
- Reuses `StaleIndexWarning` and `EmptyState` for stale, empty, and error states.

### Localization

**File**: `messages/en.json`

Adds the `emergingNarratives` strings for ranked activity, window labels, links, and page states. English is the only registered locale in this repository.

## Tests

**File**: `tests/node/emerging-narratives.test.ts`

Six focused tests cover:
- Window boundaries and exclusion of markets outside the comparison windows
- Deterministic category and top-market tie ordering
- Cancelled-market exclusion
- Unknown-category fallback and large exact stake totals
- Seven-decimal USDC stake precision
- Empty input and all known categories

## Verification

- [x] `node --import tsx --test tests/node/emerging-narratives.test.ts` under Node 22.23.3 — 6 passed
- [x] `npm run typecheck` under Node 22.23.3
- [x] `npm run check:locales`
- [x] `git diff --check`
- [x] Translation JSON parses

## Review Checklist

- [x] Page is independent of wallet state
- [x] Zero-market input renders the empty state
- [x] Stake comparisons use integer atomic units
- [x] Explorer and market links use the locale-aware navigation component
- [x] Cancelled markets do not contribute activity or appear as top markets
- [x] No contract or schema changes