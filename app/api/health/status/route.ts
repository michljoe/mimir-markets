/*
 * Public operational status surface.
 *
 * Exposes comprehensive, privacy-safe operational telemetry, deployment status,
 * contract artifact provenance, capability pause states, and health signals.
 *
 * Public and unauthenticated so operators, status dashboards, CI/CD, and external
 * uptime checkers can reliably verify system safety during normal and incident states.
 *
 * Guarantees zero secret leakage (no S… seeds, no database passwords, no auth tokens)
 * and fail-closed security (503 when critical systems are broken).
 */

import { NextResponse } from "next/server";

import {
  getClaimCount,
  getSettlementBacklog,
  getSyncMeta,
  isDbConfigured,
} from "@/lib/db";
import {
  evaluateOperationalStatusReport,
  operationalHttpStatus,
} from "@/lib/ops/operational-status";
import { readFailureWindow, readWorkerBeats } from "@/lib/ops/heartbeat";
import type { HealthSnapshot } from "@/lib/ops/health";

export const dynamic = "force-dynamic";

const EMPTY_WINDOW = { attempts: 0, failures: 0 } as const;

export interface IndexLag {
  claims: number | null;
  ledgers: number | null;
  checkedAt: string;
}

async function computeIndexLag(nowMs: number): Promise<IndexLag> {
  const checkedAt = new Date(nowMs).toISOString();

  const [claimCount, claimCursorRaw, ledgerCursorRaw, settlementCursorRaw] =
    await Promise.all([
      getClaimCount().catch(() => null),
      getSyncMeta("claim_cursor").catch(() => null),
      getSyncMeta("ledger_cursor").catch(() => null),
      getSyncMeta("settlement_cursor").catch(() => null),
    ]);

  const claimMaxId = Number(claimCursorRaw ?? "0");
  const ledgerMaxId = Number(ledgerCursorRaw ?? "0");
  const settlementCursor = Number(settlementCursorRaw ?? "0");

  const claims =
    claimCount !== null && Number.isFinite(claimMaxId)
      ? Math.max(0, claimCount - claimMaxId)
      : null;

  const ledgers =
    Number.isFinite(ledgerMaxId) && Number.isFinite(settlementCursor)
      ? Math.max(0, ledgerMaxId - settlementCursor)
      : null;

  return { claims, ledgers, checkedAt };
}

export async function GET() {
  const nowMs = Date.now();

  if (!isDbConfigured()) {
    // Database is missing: fail closed with critical status, but still surface
    // full deployment, capability, and artifact configuration.
    const emptySnapshot: HealthSnapshot = {
      workers: [],
      indexLastSyncAgeSec: null,
      oldestQueuedJobAgeSec: 0,
      oldestOverdueSettlementSec: 0,
      oracleBacklog: 0,
      rpc: EMPTY_WINDOW,
      facilitator: EMPTY_WINDOW,
      sources: EMPTY_WINDOW,
    };

    const report = evaluateOperationalStatusReport({
      nowMs,
      healthSnapshot: emptySnapshot,
    });

    report.status = "critical";
    report.mode = "outage";
    report.summary = "Mimir database is not configured (DATABASE_URL missing).";
    report.health.status = "critical";
    report.health.alarms = [
      {
        id: "db.unconfigured",
        severity: "critical",
        message: "DATABASE_URL is not configured",
        observed: 0,
        threshold: 1,
        unit: "count",
      },
    ];

    report.indexLag = { claims: null, ledgers: null, checkedAt: new Date(nowMs).toISOString() };

    return NextResponse.json(report, {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  }

  const [workers, lastSyncAt, backlog, rpc, facilitator, sources, indexLag] = await Promise.all([
    readWorkerBeats(),
    getSyncMeta("last_sync_at").catch(() => null),
    getSettlementBacklog().catch(() => null),
    readFailureWindow("rpc", nowMs),
    readFailureWindow("facilitator", nowMs),
    readFailureWindow("sources", nowMs),
    computeIndexLag(nowMs),
  ]);

  const lastSyncMs = Number(lastSyncAt ?? "0");
  const snapshot: HealthSnapshot = {
    workers,
    indexLastSyncAgeSec:
      Number.isFinite(lastSyncMs) && lastSyncMs > 0
        ? Math.max(0, Math.round((nowMs - lastSyncMs) / 1000))
        : null,
    oldestQueuedJobAgeSec: 0,
    oldestOverdueSettlementSec: backlog?.oldestOverdueSec ?? 0,
    oracleBacklog: backlog?.count ?? 0,
    rpc,
    facilitator,
    sources: sources ?? EMPTY_WINDOW,
  };

  const report = evaluateOperationalStatusReport({
    nowMs,
    healthSnapshot: snapshot,
  });

  report.indexLag = indexLag;

  if (backlog === null) {
    report.health.alarms.unshift({
      id: "db.claims_unreadable",
      severity: "critical",
      message: "settlement backlog query failed",
      observed: 0,
      threshold: 0,
      unit: "count",
    });
    report.health.status = "critical";
    report.status = "critical";
    report.mode = "outage";
  }

  return NextResponse.json(report, {
    status: operationalHttpStatus(report),
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
