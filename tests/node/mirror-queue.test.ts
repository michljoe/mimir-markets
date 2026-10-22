import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pendingMirrorsFor, type MirrorQueueDependencies } from "../../lib/server/mirror-queue";

const SUBSCRIBER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MEMBER_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NOW = 1_000_000;

function makeDeps(opts: {
  subscriptions?: string[];
  definitions?: Array<{ id: string; name: string; members: Array<{ agentId: string; weightBps: number }> }>;
  agents?: Array<{ id: string; displayName: string; address: string }>;
  claims?: Array<{ id: number; question?: string | null; deadline: number; creator?: string | null }>;
  challengers?: Record<number, Array<{ address: string; stake: number }>>;
}): MirrorQueueDependencies {
  return {
    listSubscriptions: async () => opts.subscriptions ?? [],
    listDefinitions: async () => opts.definitions ?? [],
    listAgents: async () => opts.agents ?? [],
    listOpenClaims: async () => opts.claims ?? [],
    listChallengers: async (claimId) => opts.challengers?.[claimId] ?? [],
  };
}

const BASKET = {
  id: "b",
  name: "Basket",
  members: [{ agentId: "a1", weightBps: 10_000 }],
};

const AGENT = { id: "a1", displayName: "Agent One", address: MEMBER_ADDRESS };

describe("pendingMirrorsFor", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturn(NOW * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty list when the follower has no subscriptions", () => {
    const deps = makeDeps({
      subscriptions: [],
      definitions: [BASKET],
      agents: [AGENT],
      claims: [{ id: 1, deadline: NOW + 1000 }],
      challengers: { 1: [{ address: MEMBER_ADDRESS, stake: 10 }] },
    });
    expect(pendingMirrorsFor(SUBSCRIBER, {}, deps)).toEqual([]);
  });

  it("excludes markets the follower already mirrored", () => {
    const deps = makeDeps({
      subscriptions: ["b"],
      definitions: [BASKET],
      agents: [AGENT],
      claims: [
        { id: 1, deadline: NOW + 1000 },
        { id: 2, deadline: NOW + 2000 },
      ],
      challengers: {
        1: [{ address: MEMBER_ADDRESS, stake: 10 }],
        2: [{ address: MEMBER_ADDRESS, stake: 20 }],
      },
    });
    const result = await pendingMirrorsFor(SUBSCRIBER, {}, deps);
    expect(result.map((r) => r.claimId)).toEqual([1, 2]);
  });

  it("excludes expired markets", () => {
    const deps = makeDeps({
      subscriptions: ["b"],
      definitions: [BASKET],
      agents: [AGENT],
      claims: [
        { id: 1, deadline: NOW - 1 },
        { id: 2, deadline: NOW + 1000 },
      ],
      challengers: {
        1: [{ address: MEMBER_ADDRESS, stake: 10 }],
        2: [{ address: MEMBER_ADDRESS, stake: 20 }],
      },
    });
    const result = await pendingMirrorsFor(SUBSCRIBER, {}, deps);
    expect(result.map((r) => r.claimId)).toEqual([2]);
  });

  it("deduplicates markets shared across multiple baskets", () => {
    const deps = makeDeps({
      subscriptions: ["b1", "b2"],
      definitions: [
        { id: "b1", name: "B1", members: [{ agentId: "a1", weightBps: 10_000 }] },
        { id: "b2", name: "B2", members: [{ agentId: "a1", weightBps: 10_000 }] },
      ],
      agents: [AGENT],
      claims: [{ id: 1, deadline: NOW + 1000 }],
      challengers: { 1: [{ address: MEMBER_ADDRESS, stake: 10 }] },
    });
    const result = await pendingMirrorsFor(SUBSCRIBER, {}, deps);
    const ids = result.map((r) => r.claimId);
    expect(ids).toEqual([1]);
  });

  it("carries the per-market amount through", () => {
    const deps = makeDeps({
      subscriptions: ["b"],
      definitions: [BASKET],
      agents: [AGENT],
      claims: [
        { id: 1, deadline: NOW + 1000 },
        { id: 2, deadline: NOW + 2000 },
      ],
      challengers: {
        1: [{ address: MEMBER_ADDRESS, stake: 10 }],
        2: [{ address: MEMBER_ADDRESS, stake: 25 }],
      },
    });
    const result = await pendingMirrorsFor(SUBSCRIBER, {}, deps);
    const byId = new Map(result.map((r) => [r.claimId, r.memberStakeUsdc]));
    expect(byId.get(1)).toBe(10);
    expect(byId.get(2)).toBe(25);
  });
});
