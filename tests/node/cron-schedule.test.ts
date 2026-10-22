import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const VERCEL_JSON = join(ROOT, "vercel.json");
const CRON_DIR = join(ROOT, "app", "api", "cron");

function scheduledPaths(): string[] {
  const vercel = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
  const crons = Array.isArray(vercel?.crons) ? vercel.crons : [];
  return crons.map((cron: { path: string }) => cron.path);
}

function cronRoutePaths(): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.name === "route.ts") {
        const routePath = rel.slice(0, -"route.ts".length).replace(/\/$/, "");
        out.push(`/api/${routePath}`);
      }
    }
  }
  walk(CRON_DIR, "cron");
  return out.sort();
}

// Routes intentionally run only by a worker, never by Vercel Cron.
// A route listed here must be swept by a worker on its own interval;
// otherwise schedule it in vercel.json instead.
const WORKER_ONLY: string[] = [];

test("every scheduled cron path maps to an existing route", () => {
  const scheduled = scheduledPaths();
  const existing = new Set(cronRoutePaths());
  for (const path of scheduled) {
    assert.ok(
      existing.has(path),
      `vercel.json schedules "${path}" but no app/api/cron route implements it`,
    );
  }
});

test("every scheduled cron path is unique", () => {
  const scheduled = scheduledPaths();
  assert.equal(
    new Set(scheduled).size,
    scheduled.length,
    "vercel.json schedules the same cron path more than once",
  );
});

test("every cron route is scheduled or explicitly listed as worker-only", () => {
  const scheduled = new Set(scheduledPaths());
  const workerOnly = new Set(WORKER_ONLY);
  const existing = cronRoutePaths();
  for (const path of existing) {
    assert.ok(
      scheduled.has(path) || workerOnly.has(path),
      `cron route "${path}" is neither scheduled in vercel.json nor listed as worker-only`,
    );
  }
});
