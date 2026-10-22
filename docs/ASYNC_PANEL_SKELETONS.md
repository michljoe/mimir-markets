# Async panel skeletons

Loading skeletons for dashboard, explorer, council, stats, and market async panels.

## Behavior (`lib/asyncPanelLoading.ts`)

| Phase | Meaning | UI |
| --- | --- | --- |
| `loading` / `duplicated` | In-flight (or duplicate submit) | Show skeleton |
| `ready` | Commit allowed | Render data |
| `stale` | Freshness window elapsed | Keep data; may refetch |
| `cancelled` | Effect cleanup / abort | Do not commit |
| `invalid` | Bad key/payload | No skeleton commit |
| `dependency_failure` | Missing wallet/chain/deps | Fail closed |

Money, wallet addresses, prompts, and analytics fields are never rendered inside skeleton placeholders.

## Rollout

- `CouncilVoteWidget` and market/VS loading use shared skeletons.
- Routes `app/[locale]/council/loading.tsx` and `app/[locale]/stats/loading.tsx` cover SSR council and stats navigation; `app/[locale]/council/page.tsx` wraps slow sub-sections in `Suspense` with skeleton fallbacks.
- Dashboard / explorer / stats fallbacks use `DashboardPanelSkeleton` / `ExplorerPanelSkeleton` / `StatsPanelSkeleton`.
