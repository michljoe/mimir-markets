# Cron vs worker authority

This document records which component is authoritative for each scheduled sweep,
so the same job is not run twice (once by Vercel Cron, once by a worker) and so
operators know where to look when a sweep stops running.

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically, so every
scheduled path below must be protected by the `internal_worker` tier (they are).

## Jobs scheduled in vercel.json

| Path | Schedule | Authoritative | Notes |
| ---- | -------- | ------------- | ----- |
| `/api/cron/nonce-prune` | `*/20 * * * *` | **Cron** | Prunes expired agent API nonces. No worker runs this; the cron route is the only sweep. |
| `/api/cron/sync` | `*/5 * * * *` | **Cron on serverless / Worker on Railway** | Reconciles the VS index and beats the `sync` worker heartbeat with `intervalSec` derived from `SYNC_POLL_INTERVAL_MS` (default 300000 ms → 5 min). The Railway sync worker (`agents/sync/index.ts`) runs the same idempotent reconcile on its own interval, so concurrent cron + worker runs are safe; on Vercel there is no worker, so cron is the authority. |
| `/api/cron/challenge-opportunities` | `0 * * * *` | **Cron** | Refreshes the challenge-opportunities index (TTL 24 h). No worker calls `refreshChallengeOpportunitiesIndex`; the cron route is the only sweep. The oracle agent's auto-challenger (`challengeIfMispriced`) is a separate job and is not scheduled here. |
| `/api/cron/proposals/mark-stale` | `*/30 * * * *` | **Cron** | Marks queued/in-review market proposals past their deadline as stale. No worker calls `markStaleProposals`; the cron route is the only sweep (the `POST /api/proposals/review` route also calls it, but only as part of a manual review). |

## Interval rationale

- `sync`: `*/5 * * * *` matches `SYNC_POLL_INTERVAL_MS` (default 300000 ms = 5 min). The `sync` heartbeat declares `intervalSec` from the same value, and `lib/ops/health.ts` judges staleness against `max(workerStaleWarnSec, interval * 2)` warn / `max(workerStaleCriticalSec, interval * 4)` critical, so a healthy 5-minute cadence warns at 10 min and pages at 20 min rather than alarming on a healthy worker.
- `challenge-opportunities`: hourly, well inside the 24 h index TTL.
- `proposals/mark-stale`: every 30 min, consistent with the `indexStaleCriticalSec` (1800 s) heartbeat threshold so stale proposals are surfaced promptly without racing the review window.

## Adding a new cron route

1. Create `app/api/cron/<job>/route.ts` protected by the `internal_worker` tier.
2. Add a schedule to `vercel.json` `crons`.
3. Add a row to the table above naming the authoritative component.
4. If the job is intentionally run only by a worker and never by cron, list its path in
   `WORKER_ONLY` in `tests/node/cron-schedule.test.ts` instead of scheduling it.

`tests/node/cron-schedule.test.ts` asserts that every `app/api/cron/**/route.ts` is either scheduled in `vercel.json` or explicitly listed as worker-only, and that every scheduled path maps to an existing route.
