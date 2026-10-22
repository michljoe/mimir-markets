import { mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import {
  CONTRACT_ADDRESS,
  getClaimCount,
  getOpenVSSummaries,
  getVS,
  getVSSummaries,
  type VSData,
} from "@/lib/contract";

const ACTIVE_STATES = new Set<VSData["state"]>(["open", "accepted"]);
const VS_PAGE_SIZE = 50;
const VS_FULL_REBUILD_MS = 5 * 60 * 1000;

export const VS_REVALIDATE_SECONDS = 15;
export const VS_CACHE_HEADERS = {
  "Cache-Control": `s-maxage=${VS_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
};

type VSSnapshot = {
  contractAddress: string;
  syncedAt: number;
  totalCount: number;
  items: VSData[];
};

type VSCacheState = {
  snapshot?: VSSnapshot | null;
  syncPromise?: Promise<VSSnapshot>;
};

declare global {
  var __provenVSCache: VSCacheState | undefined;
}

function getCacheState(): VSCacheState {
  if (!globalThis.__provenVSCache) {
    globalThis.__provenVSCache = {};
  }
  return globalThis.__provenVSCache;
}

function getSnapshotPath() {
  const baseDir =
    process.env.PROVEN_CACHE_DIR ||
    (process.env.VERCEL
      ? path.join(tmpdir(), "proven-cache")
      : path.join(process.cwd(), ".cache"));

  // The contract id is part of the filename so a redeploy cannot read a stale
  // snapshot. Kept verbatim so the name matches the id everything else uses; a
  // `C…` strkey is already uppercase base32, so this is not a rename in practice
  // for any correctly-configured deployment.
  return path.join(baseDir, `vs-index-${String(CONTRACT_ADDRESS)}.json`);
}

function sortVS(items: VSData[]) {
  return [...items].sort((a, b) => b.id - a.id);
}

function upsertVS(items: VSData[], updates: VSData[]) {
  if (updates.length === 0) {
    return sortVS(items);
  }

  const byId = new Map<number, VSData>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  for (const update of updates) {
    byId.set(update.id, update);
  }

  return sortVS(Array.from(byId.values()));
}

function snapshotIsFresh(snapshot: VSSnapshot | null | undefined) {
  if (!snapshot) {
    return false;
  }
  if (snapshot.contractAddress !== CONTRACT_ADDRESS) {
    return false;
  }

  return Date.now() - snapshot.syncedAt <= VS_REVALIDATE_SECONDS * 1000;
}

function shouldRebuildFromScratch(snapshot: VSSnapshot | null, count: number) {
  if (!snapshot) {
    return true;
  }
  if (snapshot.contractAddress !== CONTRACT_ADDRESS) {
    return true;
  }
  if (count < snapshot.totalCount) {
    return true;
  }

  return Date.now() - snapshot.syncedAt > VS_FULL_REBUILD_MS;
}

/**
 * Exact strakey comparison.
 *
 * The `toLowerCase()` pairing this used to do folded both sides identically, so it
 * did still match — but only as long as both values came from the same corrupted
 * source. Comparing a freshly-read `G`  against a lowercased cache entry (or the
 * reverse) silently returned nothing, which is precisely what happened once the
 * index stopped folding on write.
 */
function matchesUser(vs: VSData, address: string) {
  if (vs.creator === address) {
    return true;
  }
  if (vs.opponent === address) {
    return true;
  }

  return (vs.challenger_addresses ?? []).some(
    (challengerAddress) => challengerAddress === address
  );
}

async function readFromDisk(): Promise<VSSnapshot | null> {
  try {
    const raw = await readFile(getSnapshotPath(), "utf8");
    return JSON.parse(raw) as VSSnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshotToDisk(snapshot: VSSnapshot) {
  const snapshotPath = getSnapshotPath();

  try {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  } catch (error) {
    // Vercel's project filesystem is read-only; keep serving from memory if disk persistence fails.
    console.warn("Unable to persist VS snapshot to disk.", error);
  }
}

async function fetchAllVSSummaries(count: number) {
  if (count <= 0) {
    return [];
  }

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(count / VS_PAGE_SIZE) }, (_, index) =>
      getVSSummaries(index * VS_PAGE_SIZE + 1, VS_PAGE_SIZE)
    )
  );

  return sortVS(pages.flat());
}

function makeSnapshot(items: VSData[], totalCount: number): VSSnapshot {
  return {
    contractAddress: CONTRACT_ADDRESS,
    syncedAt: Date.now(),
    totalCount,
    items: sortVS(items),
  };
}

async function rebuildSnapshot(totalCount: number) {
  const items = await fetchAllVSSummaries(totalCount);
  const snapshot = makeSnapshot(items, totalCount);
  await writeSnapshotToDisk(snapshot);
  return snapshot;
}

async function refreshSnapshot(force = false): Promise<VSSnapshot> {
  const state = getCacheState();
  const cached = state.snapshot ?? (await readFromDisk());

  if (!force && cached && snapshotIsFresh(cached)) {
    state.snapshot = cached;
    return cached;
  }

  const totalCount = await getClaimCount();
  if (force || shouldRebuildFromScratch(cached ?? null, totalCount)) {
    const rebuilt = await rebuildSnapshot(totalCount);
    state.snapshot = rebuilt;
    return rebuilt;
  }

  let items = cached?.items ?? [];

  if (totalCount > (cached?.totalCount ?? 0)) {
    for (
      let startId = (cached?.totalCount ?? 0) + 1;
      startId <= totalCount;
      startId += VS_PAGE_SIZE
    ) {
      const freshPage = await getVSSummaries(startId, VS_PAGE_SIZE);
      items = upsertVS(items, freshPage);
    }
  }

  const liveIds = items
    .filter((item) => ACTIVE_STATES.has(item.state))
    .map((item) => item.id);

  if (liveIds.length > 0) {
    const liveItems = await getOpenVSSummaries();
    const liveSet = new Set(liveItems.map((item) => item.id));
    items = upsertVS(items, liveItems);

    const recentlyClosedIds = liveIds.filter((id) => !liveSet.has(id));
    if (recentlyClosedIds.length > 0) {
      const closedUpdates = await Promise.all(
        recentlyClosedIds.map((id) => getVS(id))
      );
      items = upsertVS(
        items,
        closedUpdates.filter((item): item is VSData => item !== null)
      );
    }
  }

  const snapshot = makeSnapshot(items, totalCount);
  await writeSnapshotToDisk(snapshot);
  state.snapshot = snapshot;
  return snapshot;
}

async function ensureSnapshot(force = false) {
  const state = getCacheState();
  const cached = state.snapshot ?? (await readFromDisk());
  if (!force && cached && snapshotIsFresh(cached)) {
    state.snapshot = cached;
    return cached;
  }

  if (!state.syncPromise || force) {
    state.syncPromise = refreshSnapshot(force).finally(() => {
      const currentState = getCacheState();
      currentState.syncPromise = undefined;
    });
  }

  return state.syncPromise;
}

export async function refreshVSIndex() {
  return ensureSnapshot(true);
}

export async function getAllVSFastSnapshot(): Promise<{ items: VSData[]; syncedAt: number }> {
  const snapshot = await ensureSnapshot();
  return { items: snapshot.items, syncedAt: snapshot.syncedAt };
}

export async function getAllVSFast(): Promise<VSData[]> {
  return (await getAllVSFastSnapshot()).items;
}

export async function getVSByIdFast(vsId: number): Promise<VSData | null> {
  const snapshot = await ensureSnapshot();
  const found = snapshot.items.find((vs) => vs.id === vsId);
  const live = await getVS(vsId);
  if (!live) {
    return found ?? null;
  }

  const updatedSnapshot = makeSnapshot(
    upsertVS(snapshot.items, [live]),
    Math.max(snapshot.totalCount, live.id)
  );
  await writeSnapshotToDisk(updatedSnapshot);
  getCacheState().snapshot = updatedSnapshot;

  return live;
}

export async function getUserVSFast(address: string): Promise<VSData[]> {
  const snapshot = await ensureSnapshot();
  return snapshot.items.filter((vs) => matchesUser(vs, address));
}

export { filterPublicClaims, SITEMAP_CLAIM_LIMIT } from "@/lib/server/sitemap-claims";
