/**
 * Resolve an agent id to a human-readable label for the reasoning feed filter.
 *
 * Resolution order:
 *   1. Agent directory data already known to the page (id -> displayName).
 *   2. The council / philosopher persona registry (slug -> displayName).
 *   3. The raw id — unknown ids stay selectable and fall back to their id.
 *
 * Pure: the directory map is passed in, so this is testable without a database,
 * secrets, or env vars. Council/philosopher names come from the static persona
 * roster (the same data lib/council-resolver.ts indexes), which is client-safe
 * and env-free, unlike lib/council-resolver.ts and lib/server/agent-directory.ts
 * (both `server-only`).
 */

import { listCouncilPersonas } from "../../agents/council/personas";
import { PHILOSOPHER_PERSONAS } from "../../agents/council/philosophers";

export type AgentNames = ReadonlyMap<string, string>;

/** Persona roster keyed by slug, built once per module load. */
const personaBySlug: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const persona of [...listCouncilPersonas(), ...PHILOSOPHER_PERSONAS]) {
    map.set(persona.slug, persona.displayName);
  }
  return map;
})();

/**
 * Resolve `agentId` to a display name. Directory data wins over the persona
 * registry; anything unknown falls back to the id so it stays selectable.
 */
export function agentLabel(agentId: string, names: AgentNames): string {
  const directoryName = names.get(agentId);
  if (directoryName) return directoryName;
  const personaName = personaBySlug.get(agentId);
  if (personaName) return personaName;
  return agentId;
}

/**
 * Build filter options from agent ids, resolved to display names and sorted by
 * name. Values stay ids; unknown ids appear under their own id.
 */
export function agentOptions(
  agentIds: string[],
  names: AgentNames,
): ReadonlyArray<{ id: string; label: string }> {
  return [...agentIds]
    .map((id) => ({ id, label: agentLabel(id, names) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
