import type { VData } from "./contract";

const STORAGE_KEY = "proven_pending_vs";

export interface PendingVS extends VData {
  /** Flag that marks this item as locally-optimistic (not yet on-chain). */
  pending: true;
  /** Epoch ms when the item was stored — used for automatic expiry. */
  createdAtMs: number;
  /** Optional tx hash for explorer link. */
  txHash?: string;
}

/** Max age before a pending item is silently discarded (5 minutes). */
const MAX_AGE_MS = 5 * 60 * 1000;

function readAll(): PendingVS[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: PendingVS[] = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    const now = Date.now();
    return items.filter((a) => now - a.createdAtMs < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeAll(items: PendingVS[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded — ignore
  }
}

/** Save a newly created VS so it shows up immediately in lists. */
export function savePendingVS(vs: PendingVS) {
  const items = readAll().filter((i) => i.id !== vs.id);
  items.unshift(vs);
  writeAll(items);
}

/** Look up a single pending VS by id. */
export function getPendingVS(id: number): PendingVS | null {
  return readAll().find((i) => i.id === id) ?? null;
}

/** Remove a pending VS once it appears on-chain. */
export function removePendingVS(id: number) {
  writeAll(readAll().filter((i) => i.id !== id));
}

/**
 * Merge pending VS into a list fetched from the contract.
 * Items that already exist on-chain are removed from localStorage.
 * Remaining pending items are prepended to the list.
 */
export function mergePendingVS(
  onChain: VData[],
  filterAddress?: string
): VData[] {
  const pending = readAll();
  if (pending.length === 0) return onChain;

  const onChainIds = new Set(onChain.map((v) => v.id));
  const stillPending: PendingVS[] = [];

  for (const p of pending) {
    if (onChainIds.has(p.id)) {
      // appeared on-chain — drop from localStorage
      removePendingVS(p.id);
    } else if (
      !filterAddress ||
      p.creator.toLowerCase() === filterAddress.toLowerCase()
    ) {
      stillPending.push(p);
    }
  }

  return [...stillPending, ...onChain];
}
