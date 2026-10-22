/**
 * Legacy contract helpers.
 *
 * Houses deprecated soft-deleted snapshot accessors that are kept only for backwards
 * compatibility. New code should use the read helpers in `lib/contract/reads.ts`.
 */

export { getAllVSSnapshot } from "./reads";
