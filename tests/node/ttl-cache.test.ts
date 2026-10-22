import { describe, it, expect, vi } from "vitest";
import { cachedFor } from "@/lib/server/ttl-cache";

describe("cachedFor", () => {
  it("memoizes successful results within the TTL", () => {
    const fn = vi.fn(async (a: number) => a * 2);
    const cached = cachedFor(fn, 1000);

    return Promise.all([cached(2), cached(2)]).then(([a, b]) => {
      expect(a).to.Be(4);
      expect(b).to.Be(4);
      expect(fn).to.HaveBeenCalledTimes(1);
    });
  });

  it("re-invokes fn after a rejection", async () => {
    const fn = vi.fn();
    fn.mockRejectedOnce(new Error("boom"));
    fn.mockResolvedOnce("ok");
    const cached = cachedFor(fn, 1000);

    await expect(cached()).toReject();
    await expect(cached()).toResolve("ok");
    expect(fn).to.HaveBeenCalledTimes(2);
  });

  it("evicts expired entries on access", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn().mockResolved("value");
      const cached = cachedFor(fn, 1000);

      await cached("a");
      expect(fn).to.HaveBeenCalledTimes(1);

      vi.advanceTimersBy(1001);
      await cached("a");
      expect(fn).to.HaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never exceeds the max entries cap", () => {
    const fn = vi.fn(async (a: number) => a);
    const cached = cachedFor(fn, 1000, 3);

    for (let i = 0; i < 10; i++) {
      void cached(i);
    }

    // Only the most recent 3 keys should remain cached.
    for (let i = 0; i < 7; i++) {
      void cached(i);
    }
    for (let i = 7; i < 10; i++) {
      void cached(i);
    }

    // Keys 0-6 were evicted, so they re-invoke fn; keys 7-9 are cached.
    expect(fn.mock.calls.length).to.Be(10 + 7);
  });
});

function controlledClock(start = 1000) {
  let now = start;
  const original = Date.now;
  Date.now = () => now;
  return {
    advance(ms: number) {
      now += ms;
    },
    restore() {
      Date.now = original;
    },
  };
}

test("cached-for returns the memoized value on a hit within the ttl", async () => {
  const clock = controlledClock();
  try {
    let calls = 0;
    const read = cachedFor(async (id: number) => {
      calls += 1;
      return id * 10;
    }, 5000);

    assert.strictEqual(await read(2), 20);
    clock.advance(4999);
    assert.strictEqual(await read(2), 20);
    assert.strictEqual(calls, 1, "function should only run once within ttl");
  } finally {
    clock.restore();
  }
});

test("cached-for re-invokes the function after the ttl expires", async () => {
  const clock = controlledClock();
  try {
    let calls = 0;
    const read = cachedFor(async (id: number) => {
      calls += 1;
      return id + calls;
    }, 1000);

    assert.strictEqual(await read(1), 2);
    clock.advance(1000);
    assert.strictEqual(await read(1), 3);
    assert.strictEqual(calls, 2, "function should re-run after ttl");
  } finally {
    clock.restore();
  }
});

test("cached-for keys entries by json-stringified arguments", async () => {
  const clock = controlledClock();
  try {
    const calls = new Map<string, number>();
    const read = cachedFor(async (args: { id: number }) => {
      const key = JSON.stringify(args);
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return args.id * 100;
    }, 5000);

    assert.strictEqual(await read({ id: 1 }), 100);
    assert.strictEqual(await read({ id: 2 }), 200);
    // Distinct args must not collide.
    assert.strictEqual(calls.get(JSON.stringify({ id: 1 })), 1);
    assert.strictEqual(calls.get(JSON.stringify({ id: 2 })), 1);

    // Repeating the first args hits the cache instead of re-running.
    assert.strictEqual(await read({ id: 1 }), 100);
    assert.strictEqual(calls.get(JSON.stringify({ id: 1 })), 1);
  } finally {
    clock.restore();
  }
});

test("cached-for shares one in-flight promise among concurrent callers", async () => {
  const clock = controlledClock();
  try {
    let calls = 0;
    let resolve: (value: number) => void = () => {};
    const pending = new Promise<number>((r) => {
      resolve = r;
    });
    const read = cachedFor((_id: number) => {
      calls += 1;
      return pending;
    }, 5000);

    const a = read(7);
    const b = read(7);
    const c = read(7);
    assert.strictEqual(calls, 1, "concurrent callers should share one call");

    resolve(42);
    const results = await Promise.all([a, b, c]);
    assert.deepStrictEqual(results, [42, 42, 42]);
    assert.strictEqual(calls, 1);
  } finally {
    clock.restore();
  }
});