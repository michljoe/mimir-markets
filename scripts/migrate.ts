/*
 * Release migration CLI — reversible up/down without production secrets.
 *
 * Default mode is `--fixture`: an in-memory store that rehearses the full
 * migration chain offline. Pass `--live` to apply migrations to a real Postgres
 * database configured via DATABASE_URL. Live mode uses the reviewed
 * PostgresMigrationStore (advisory lock, one transaction per migration,
 * checksum drift detection). The fixture store remains the default so the
 * check is reproducible from a clean checkout.
 *
 * Usage:
 *   npm run migrate:status
 *   npm run migrate:up
 *   npm run migrate:down
 *   npm run migrate:verify
 *   npx tsx scripts/migrate.ts status|up|down|verify [--fixture] [--live] [--force-destructive] [--steps N]
 *
 * Exit codes:
 *   0 — success / checksums ok
 *   1 — failure (checksum mismatch, blocked irreversible down, step error)
 */

import {
  MemoryMigrationStore,
  PostgresMigrationStore,
  getStatus,
  migrateDown,
  migrateUp,
  type MigrationStore,
} from "../lib/migrations";

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const positional = argv.filter((a) => !a.startsWith("--"));
  const command = (positional[0] ?? "status").toLowerCase();

  let steps = 1;
  const stepsIdx = argv.indexOf("--steps");
  if (stepsIdx >= 0 && argv[stepsIdx + 1]) {
    steps = Number(argv[stepsIdx + 1]);
    if (!Number.isFinite(steps) || steps < 1) {
      throw new Error("--steps must be a positive integer");
    }
  }

  return {
    command,
    fixture: args.has("--fixture") || !args.has("--live"),
    live: args.has("--live"),
    forceDestructive: args.has("--force-destructive"),
    quiet: args.has("--quiet"),
    steps,
  };
}

async function createStore(opts: {
  fixture: boolean;
  live: boolean;
}): Promise<MigrationStore> {
  if (opts.fixture) {
    return new MemoryMigrationStore();
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "--live requires DATABASE_URL to be set; refusing to fall back to the fixture store.",
    );
  }

  return PostgresMigrationStore.connect(databaseUrl);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const store = await createStore(opts);

  try {
    if (opts.command === "status" || opts.command === "verify") {
      const status = await getStatus(store);
      if (!opts.quiet) {
        console.log("Release migration status");
        console.log(`  head: ${status.headVersion ?? "none"}`);
        console.log(`  pending: ${status.pendingVersions.join(", ") || "none"}`);
        console.log(`  checksumsOk: ${status.checksumsOk}`);
        for (const row of status.registered) {
          const flag = row.applied ? "applied" : "pending";
          const irr = row.irreversible ? " irreversible" : "";
          console.log(
            `  - v${row.version} ${row.id} [${flag}${irr}] ${row.description}`,
          );
        }
        if (status.issues.length > 0) {
          console.log("  issues:");
          for (const issue of status.issues) console.log(`    * ${issue}`);
        }
      }
      if (opts.command === "verify") {
        // Verify means: registry is well-formed and a full up→down(reversible)→up cycle works.
        const up = await migrateUp(store, { failFast: true });
        if (!up.ok) {
          console.error(up.summary);
          return 1;
        }
        // Revert only the reversible head (v3); leave irreversible baselines blocked.
        const down = await migrateDown(store, {
          steps: 1,
          failFast: true,
          forceDestructive: false,
        });
        if (!down.ok) {
          console.error(down.summary);
          for (const s of down.steps) {
            if (s.error) console.error(`  ${s.migrationId}: ${s.error}`);
          }
          return 1;
        }
        const upAgain = await migrateUp(store, { failFast: true });
        if (!upAgain.ok) {
          console.error(upAgain.summary);
          return 1;
        }
        if (!opts.quiet) {
          console.log(up.summary);
          console.log(down.summary);
          console.log(upAgain.summary);
          console.log("verify: reversible release migration cycle passed");
        }
        return status.issues.length === 0 ? 0 : 1;
      }
      return status.issues.length === 0 ? 0 : 1;
    }

    if (opts.command === "up") {
      const result = await migrateUp(store, { failFast: true });
      if (!opts.quiet) {
        for (const step of result.steps) {
          console.log(
            `  ${step.status} up v${step.version} ${step.migrationId}${step.error ? ` — ${step.error}` : ""}`,
          );
        }
        console.log(result.summary);
      }
      return result.ok ? 0 : 1;
    }

    if (opts.command === "down") {
      const result = await migrateDown(store, {
        steps: opts.steps,
        failFast: true,
        forceDestructive: opts.forceDestructive,
      });
      if (!opts.quiet) {
        for (const step of result.steps) {
          console.log(
            `  ${step.status} down v${step.version} ${step.migrationId}${step.error ? ` — ${step.error}` : ""}`,
          );
        }
        console.log(result.summary);
      }
      return result.ok ? 0 : 1;
    }

    console.error(
      `Unknown command "${opts.command}". Use status|up|down|verify.`,
    );
    return 1;
  } finally {
    await store.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`migrate: ${message}`);
    process.exit(1);
  });
