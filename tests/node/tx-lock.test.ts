import assert from "node:assert/strict";
import test from "node:test";

import { acquireTxLock } from "../../lib/tx-lock";

const LOCK_TTL_MS = 30_000;
const LOCK_REFRESH_MS = 5_000;
const INITIAL_NOW_MS = 1_700_000_000_000;

interface StoredLockEntry {
  tabId: string;
  scope: string;
  ts: number;
}

interface ScheduledInterval {
  id: number;
  callback: () => void;
  delayMs: number;
  nextFireAt: number;
}

function setupBrowserLockEnv(initialNow = INITIAL_NOW_MS) {
  let now = initialNow;
  let nextTimerId = 1;
  let activeSimulatedTab: string | null = null;
  let runtimeTabId: string | null = null;

  const intervals = new Map<number, ScheduledInterval>();
  const store = new Map<string, string>();

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalDateNow = Date.now;

  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      const raw = store.has(key) ? (store.get(key) ?? null) : null;
      if (!raw || !activeSimulatedTab) {
        return raw;
      }
      try {
        const parsed = JSON.parse(raw) as StoredLockEntry;
        if (parsed && typeof parsed.tabId === "string") {
          if (parsed.tabId === activeSimulatedTab && runtimeTabId) {
            return JSON.stringify({ ...parsed, tabId: runtimeTabId });
          }
          if (runtimeTabId && parsed.tabId === runtimeTabId) {
            return JSON.stringify({ ...parsed, tabId: "primary-tab" });
          }
        }
      } catch {
        return raw;
      }
      return raw;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      const raw = String(value);
      try {
        const parsed = JSON.parse(raw) as StoredLockEntry;
        if (parsed && typeof parsed.tabId === "string") {
          if (!runtimeTabId) {
            runtimeTabId = parsed.tabId;
          }
          if (activeSimulatedTab && parsed.tabId === runtimeTabId) {
            store.set(key, JSON.stringify({ ...parsed, tabId: activeSimulatedTab }));
            return;
          }
        }
      } catch {
        // Store malformed JSON as-is for corrupt lock tests.
      }
      store.set(key, raw);
    },
  };

  function runInTab<T>(tabId: string | null, fn: () => T): T {
    const previousTab = activeSimulatedTab;
    activeSimulatedTab = tabId;
    try {
      const result = fn();
      if (typeof result === "function") {
        return (() => runInTab(tabId, result as () => unknown)) as unknown as T;
      }
      return result;
    } finally {
      activeSimulatedTab = previousTab;
    }
  }

  const windowShim = {
    localStorage: storage,
    setInterval(callback: () => void, delayMs?: number): number {
      const id = nextTimerId++;
      const step = Math.max(1, Number(delayMs ?? 0));
      const ownerTab = activeSimulatedTab;
      intervals.set(id, {
        id,
        callback: () => runInTab(ownerTab, callback),
        delayMs: step,
        nextFireAt: now + step,
      });
      return id;
    },
    clearInterval(id?: number) {
      if (typeof id === "number") {
        intervals.delete(id);
      }
    },
  };

  Object.defineProperty(globalThis, "window", {
    value: windowShim,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  Date.now = () => now;

  function setNow(targetMs: number) {
    now = targetMs;
  }

  function advanceTime(deltaMs: number) {
    if (deltaMs < 0) {
      throw new Error("advanceTime requires a non-negative deltaMs");
    }
    const target = now + deltaMs;
    while (true) {
      let earliest: ScheduledInterval | null = null;
      for (const timer of intervals.values()) {
        if (timer.nextFireAt <= target) {
          if (!earliest || timer.nextFireAt < earliest.nextFireAt) {
            earliest = timer;
          }
        }
      }
      if (!earliest) {
        break;
      }
      now = earliest.nextFireAt;
      earliest.nextFireAt += earliest.delayMs;
      earliest.callback();
    }
    now = target;
  }

  function readStoredLock(rawScope: string): StoredLockEntry | null {
    const key = `proven_tx_lock:${rawScope.trim().toLowerCase()}`;
    const raw = store.get(key);
    return raw ? (JSON.parse(raw) as StoredLockEntry) : null;
  }

  function restore() {
    Date.now = originalDateNow;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }

  return {
    storage,
    store,
    intervals,
    getNow: () => now,
    setNow,
    advanceTime,
    readStoredLock,
    asTab: <T>(tabId: string, fn: () => T): T => runInTab(tabId, fn),
    restore,
  };
}

test("SSR no-op: returns a safe release function without touching storage when window is undefined", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;

    const release = acquireTxLock("GABC1234567890WALLETADDRESS");
    assert.equal(typeof release, "function");
    assert.doesNotThrow(() => release());
    assert.doesNotThrow(() => release());
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    }
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    }
  }
});

test("acquire and release: writes lock entry to localStorage and removes it on release", () => {
  const env = setupBrowserLockEnv();
  try {
    const wallet = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
    const key = `proven_tx_lock:${wallet.toLowerCase()}`;

    const release = acquireTxLock(wallet);
    assert.equal(env.store.size, 1);
    assert.equal(env.intervals.size, 1);

    const entry = env.readStoredLock(wallet);
    assert.ok(entry, "lock entry should be stored in localStorage");
    assert.equal(entry.scope, wallet.toLowerCase());
    assert.equal(entry.ts, INITIAL_NOW_MS);
    assert.equal(typeof entry.tabId, "string");
    assert.ok(entry.tabId.length > 0);

    release();
    assert.equal(env.storage.getItem(key), null, "lock entry should be cleared on release");
    assert.equal(env.intervals.size, 0, "refresh interval should be cleared on release");

    // Releasing a second time is a no-op and does not throw
    assert.doesNotThrow(() => release());
  } finally {
    env.restore();
  }
});

test("second acquire blocked: another tab cannot acquire an active lock for the same scope", () => {
  const env = setupBrowserLockEnv();
  try {
    const wallet = "GCONCURRENTWALLET23456789234567892345678923456789234567";

    const releaseTabA = acquireTxLock(wallet);
    const tabALock = env.readStoredLock(wallet);
    assert.ok(tabALock);

    env.advanceTime(1_000);

    assert.throws(
      () => env.asTab("tab-b", () => acquireTxLock(wallet)),
      /Another transaction is already in progress for this wallet in a different tab/,
    );

    // Tab A's lock remains intact in localStorage
    const afterBlocked = env.readStoredLock(wallet);
    assert.deepEqual(afterBlocked, tabALock);

    // A different wallet scope is independent and can be locked by Tab B concurrently
    const otherWallet = "GOTHERWALLET2345678923456789234567892345678923456789234";
    const releaseOther = env.asTab("tab-b", () => acquireTxLock(otherWallet));
    assert.ok(env.readStoredLock(otherWallet));
    releaseOther();

    // Once Tab A releases, Tab B can acquire the lock immediately
    releaseTabA();
    const releaseTabBAfter = env.asTab("tab-b", () => acquireTxLock(wallet));
    const tabBLock = env.readStoredLock(wallet);
    assert.ok(tabBLock);
    assert.equal(tabBLock.tabId, "tab-b");
    assert.notEqual(tabBLock.tabId, tabALock.tabId);
    releaseTabBAfter();
    assert.equal(env.readStoredLock(wallet), null);
  } finally {
    env.restore();
  }
});

test("stale lock expiry: blocks before LOCK_TTL_MS and allows another tab to steal at LOCK_TTL_MS", () => {
  const env = setupBrowserLockEnv();
  try {
    const wallet = "GSTALEWALLET2345678923456789234567892345678923456789234";

    const releaseTabA = acquireTxLock(wallet);
    const tabALock = env.readStoredLock(wallet);
    assert.ok(tabALock);

    // Simulate Tab A crashing / freezing so its refresh timer never fires
    env.intervals.clear();

    // 1 ms before TTL expiry (29,999 ms elapsed): still alive, Tab B is blocked
    env.setNow(INITIAL_NOW_MS + LOCK_TTL_MS - 1);
    assert.throws(
      () => env.asTab("tab-b", () => acquireTxLock(wallet)),
      /Another transaction is already in progress for this wallet in a different tab/,
    );

    // Exactly at TTL expiry (30,000 ms elapsed): lock is stale, Tab B steals it
    env.setNow(INITIAL_NOW_MS + LOCK_TTL_MS);
    const releaseTabB = env.asTab("tab-b", () => acquireTxLock(wallet));
    const stolenLock = env.readStoredLock(wallet);
    assert.ok(stolenLock);
    assert.equal(stolenLock.tabId, "tab-b");
    assert.notEqual(stolenLock.tabId, tabALock.tabId);
    assert.equal(stolenLock.ts, INITIAL_NOW_MS + LOCK_TTL_MS);

    // Late release from stale Tab A must not clobber Tab B's active lock
    releaseTabA();
    assert.deepEqual(env.readStoredLock(wallet), stolenLock);

    releaseTabB();
    assert.equal(env.readStoredLock(wallet), null);
  } finally {
    env.restore();
  }
});

test("heartbeat refresh: active lock refreshes timestamp every 5s and stays alive past initial TTL", () => {
  const env = setupBrowserLockEnv();
  try {
    const wallet = "GREFRESHWALLET23456789234567892345678923456789234567892";

    const releaseTabA = acquireTxLock(wallet);
    assert.equal(env.readStoredLock(wallet)?.ts, INITIAL_NOW_MS);

    // Advance by one refresh interval (5,000 ms)
    env.advanceTime(LOCK_REFRESH_MS);
    assert.equal(env.readStoredLock(wallet)?.ts, INITIAL_NOW_MS + LOCK_REFRESH_MS);

    // Advance past the original 30,000 ms TTL with refresh timer running (total 35,000 ms)
    env.advanceTime(LOCK_TTL_MS);
    assert.equal(env.readStoredLock(wallet)?.ts, INITIAL_NOW_MS + LOCK_REFRESH_MS + LOCK_TTL_MS);

    // Tab B is still blocked because the heartbeat kept refreshing the timestamp
    assert.throws(
      () => env.asTab("tab-b", () => acquireTxLock(wallet)),
      /Another transaction is already in progress for this wallet in a different tab/,
    );

    releaseTabA();
    assert.equal(env.readStoredLock(wallet), null);

    // Advancing time after release does not re-create the lock entry
    env.advanceTime(LOCK_REFRESH_MS * 2);
    assert.equal(env.readStoredLock(wallet), null);
  } finally {
    env.restore();
  }
});

test("scope normalisation: trims whitespace, folds case, and treats blank scopes as no-ops", () => {
  const env = setupBrowserLockEnv();
  try {
    const rawUpper = "  GABC23456789234567892345678923456789234567892345678923  ";
    const rawLower = "\tgabc23456789234567892345678923456789234567892345678923\n";
    const canonicalScope = "gabc23456789234567892345678923456789234567892345678923";

    const release = acquireTxLock(rawUpper);
    const stored = env.readStoredLock(canonicalScope);
    assert.ok(stored);
    assert.equal(stored.scope, canonicalScope);
    assert.equal(env.storage.getItem(`proven_tx_lock:${canonicalScope}`), JSON.stringify(stored));

    // Another tab passing differently cased / padded form of the same address is blocked
    assert.throws(
      () => env.asTab("tab-b", () => acquireTxLock(rawLower)),
      /Another transaction is already in progress for this wallet in a different tab/,
    );

    release();
    assert.equal(env.readStoredLock(canonicalScope), null);

    // Blank / whitespace-only scopes return a no-op release without writing to storage
    for (const blank of ["", "   ", "\t\r\n"]) {
      const noopRelease = acquireTxLock(blank);
      assert.equal(env.store.size, 0);
      assert.equal(env.intervals.size, 0);
      assert.doesNotThrow(() => noopRelease());
    }
  } finally {
    env.restore();
  }
});

test("corrupt storage and post-write race verification are handled safely", () => {
  const env = setupBrowserLockEnv();
  try {
    const wallet = "GCORRUPTWALLET23456789234567892345678923456789234567892";
    const key = `proven_tx_lock:${wallet.toLowerCase()}`;

    // Malformed JSON in localStorage is ignored and overwritten cleanly
    env.storage.setItem(key, "{not-valid-json");
    const release = acquireTxLock(wallet);
    assert.equal(env.readStoredLock(wallet)?.scope, wallet.toLowerCase());
    release();

    // If another tab wins the write race before post-write verification, acquireTxLock throws
    const originalSetItem = env.storage.setItem.bind(env.storage);
    env.storage.setItem = (k: string, _v: string) => {
      originalSetItem(
        k,
        JSON.stringify({
          tabId: "competing-tab-winner",
          scope: wallet.toLowerCase(),
          ts: env.getNow(),
        }),
      );
    };

    assert.throws(
      () => acquireTxLock(wallet),
      /Another transaction is already in progress for this wallet in a different tab/,
    );
  } finally {
    env.restore();
  }
});
