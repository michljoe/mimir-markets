import { describe, it, expect, beforeEach, vi } from "vitest";

// Inject registry (de) and performance sources so these tests never touch the network or real credentials.
// The mocks are hoisted and reset between cases to keep every assertion deterministic.

const mockState = vi.hoisted({
  agents: [] as Array<{ id: string; address: string; track: string; [key: string]: unknown }>,
  tradeRowsByAddress: new Map<string, unknown[]>(),
  baskets: [] as Array<Record<string, unknown>>,
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  listAgents: vi.fn(async () => mockState.agents),
  getAgentTradeRows: vi.fn(async (address: string) => mockState.tradeRowsByAddress.get(address) ?? []),
  listBaskets: vi.fn(async () => mockState.baskets),
}));

vi.mock("@/lib/agents/performance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/performance")>();
  return {
    ...actual,
    // Deterministic clock: windows are computed relative to a fixed epoch.
    windowSinceMs: vi.fn((window: string, nowMs: number) => {
      if (window === "all") return null;
      const day = 86_400_000;
      const days = window === "7d" ? 7 : window === "30d" ? 30 : 365;
      return nowMs - days * day;
    }),
  };
});

import {
  buildBasketView,
  findBasketDefinition,
  findAnyBasketDefinition,
  allBasketDefinitions,
  BASK_DEFINITIONS,
  type BasketDefinition,
} from "@/lib/server/basket-directory";
import {
  listDirectoryAgents,
  findDirectoryAgent,
  listAgentsWithPerformance,
  type DirectoryAgent,
} from "@/lib/server/agent-directory";

const FIXED_NOW = Date.UTC(2025, 0, 15, 12, 0, 0);

const agent = (id: string, address: string, track: string = "council"): DirectoryAgent =>
  ({ id, address, track, name: id, description: "", emoji: "" } as unknown as DirectoryAgent);

const settled = (address: string, pnlAtomic: bigint, stakeAtomic: bigint, settledAt: number) => ({
  agentAddress: address,
  outcome: pnlAtomic >= 0n ? "win" : "loss",
  pnlAtomic,
  stakeAtomic,
  settledAt,
});

beforeEach(() => {
  mockState.agents = [];
  mockState.tradeRowsByAddress.clear();
  mockState.baskets = [];
  vi.clearAllMocks();
});

describe("agent directory", () => {
  it("lists every registered agent in registry order", () => {
    mockState.agents = [agent("optimist", "0xa"), agent("pessimist", "0xb")];
    return expect(listDirectoryAgents()).resolves.toEqual(["optimist", "pessimist"].map((id) => expect.objectContaining({ id })));
  });

  it("finds a directory agent by id and returns null for an unknown id", () => {
    mockState.agents = [agent("optimist", "0xa")];
    return Promise.all([
      findDirectoryAgent("optimist"),
      findDirectoryAgent("ghost"),
    ]).then(([known, unknown]) => {
      expect(known?.id).toBe("optimist");
      expect(unknown).toBeNull();
    });
  });

  it("merges performance into each directory agent", () => {
    mockState.agents = [agent("optimist", "0xa")];
    mockState.tradeRowsByAddress.set("0xa", [
      settled("0xa", 100n, 1_000n, FIXED_NOW.getTime() - 1_000_000),
    ]);
    return listAgentsWithPerformance().then((rows) => {
      expect(rows).length(1);
      expect(rows[0].id).toBe("optimist");
      expect(rows[0].performance.settled).toBe(1);
    });
  });
});

describe("basket directory", () => {
  it("resolves curated basket members and reports no missing ids", () => {
    mockState.agents = [
      agent("optimist", "0xa"),
      agent("pessimist", "0xb"),
      agent("contrarian", "0xc"),
      agent("statistician", "0xd"),
    ];
    const def = findBasketDefinition("council-core");
    expect(def).not.toBeNull();
    return buildBasketView(def!, "all", FIXED_NOW.getTime()).then((view) => {
      expect(view.members.map((m) => m.id)).toEqual(["optimist", "pessimist", "contrarian", "statistician"]);
      expect(view.missing).toEqual([]);
    });
  });

  it("reports missing members without dropping the resolved ones", () => {
    mockState.agents = [agent("optimist", "0xa")];
    const def: BasketDefinition = {
      id: "test", name: "Test", emoji: "🧺", thesis: "",
      members: [
        { agentId: "optimist", weightBps: 5_000 },
        { agentId: "ghost", weightBps: 5_000 },
      ],
    };
    return buildBasketView(def, "all", FIXED_NOW.getTime()).then((view) => {
      expect(view.members.map((m) => m.id)).toEqual(["optimist"]);
      expect(view.missing).toEqual(["ghost"]);
    });
  });

  it("scales member contribution by allocation weight", () => {
    mockState.agents = [agent("optimist", "0xa")];
    mockState.tradeRowsByAddress.set("0xa", [
      settled("0xa", 1_000n, 10_000n, FIXED_NOW.getTime() - 1_000_000),
    ]);
    const def: BasketDefinition = {
      id: "half", name: "Half", emoji: "🧱", thesis: "",
      members: [{ agentId: "optimist", weightBps: 5_000 }],
    };
    return buildBasketView(def, "all", FIXED_NOW.getTime()).then((view) => {
      expect(view.members[0].contributionAtomic).toBe(500n);
      expect(view.realisedPnlAtomic).toBe(500n);
    });
  });

  it("returns curated definitions from findBasketDefinition and null for unknown ids", () => {
    expect(findBasketDefinition("council-core")?.id).toBe("council-core");
    expect(findBasketDefinition("not-a-basket")).toBeNull();
  });

  it("merges user baskets after curated ones in allBasketDefinitions", () => {
    mockState.baskets = [
      {
        basketId: "user-1", name: "My Basket", thesis: "",
        membersJson: JSON.stringify([{
          agentId: "optimist", weightBps: 10_000 }]),
        creatorWallet: "0xcreator", subscriberCount: 3, createdAt: 123,
      },
    ];
    return allBasketDefinitions().then((defs) => {
      expect(defs.length).toBe(BASK_DEFINITIONS.length + 1);
      const user = defs.at(-1)!;
      expect(user.id).toBe("user-1");
      expect(user.creatorWallet).toBe("0xcreator");
      expect(user.members).toEqual([{ agentId: "optimist", weightBps: 10_000 }]);
    });
  });

 it("tolerates malformed user basket members json by falling back to empty members", () => {
    mockState.baskets = [
      { basketId: "broken", name: "Broken", thesis: "", membersJson: "not json", creatorWallet: "0xc" },
    ];
    return allBasketDefinitions().then((defs) => {
      const broken = defs.find((d) => d.id === "broken");
      expect(broken?.members).toEqual([]);
    });
  });

  it("finds a user basket through findAnyBasketDefinition", () => {
    mockState.baskets = [
      { basketId: "user-2", name: "User Two", thesis: "", membersJson: "[]", creatorWallet: "0xc" },
    ];
    return Promise.all([
      findAnyBasketDefinition("user-2"),
      findAnyBasketDefinition("not-a-basket"),
    ]).then(([known, unknown]) => {
      expect(known?.id).toBe("user-2");
      expect(unknown).toBeNull();
    });
  });
});
