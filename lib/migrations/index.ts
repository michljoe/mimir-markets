/**
 * Reversible release migrations — public API.
 *
 * Offline-safe by default via MemoryMigrationStore. Use the CLI
 * (`npm run migrate:status` / `migrate:up` / `migrate:down`) for release
 * rehearsals without production secrets. Pass `--live` with a configured
 * `DATABASE_URL` to apply against a real Postgres database.
 */

export { checksumMigration, canonicalizeMigration } from "./checksum";
export { MemoryMigrationStore } from "./memory-store";
export { PostgresMigrationStore } from "./postgres-store";
export type { PostgresPool, PostgresPoolClient } from "./postgres-store";
export {
  MIGRATIONS,
  getMigrationById,
  getMigrationByVersion,
  latestRegisteredVersion,
} from "./registry";
export {
  getStatus,
  migrateDown,
  migrateUp,
  planMigrateDown,
  planMigrateUp,
} from "./runner";
export type { RunnerOptions } from "./runner";
export type {
  AppliedMigration,
  MigrateDirection,
  MigratePlan,
  MigrateResult,
  MigrateStepResult,
  Migration,
  MigrationStatement,
  MigrationStatus,
  MigrationStore,
} from "./types";
export { appearsToContainSecret, redactErrorMessage } from "./types";