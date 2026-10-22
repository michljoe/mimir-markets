import assert from "node:assert/strict";
import test from "node:test";

import { MimirAgentClient } from "../../sdk/agents";

function makeClient(overrides: Partial<ConstructorParameters<typeof MimirAgentClient>[0]> = {}) {
  return new MimirAgentClient({
    baseUrl: "https://agent.example",
    agentId: "agent-42",
    signMessage: async () => "sig",
    timeoutMs: 50,
    ...overrides,
  });
}

test("request uses the injected transport and succeeds", async () => {
  const client = makeClient({
    fetch: async (url, init) => {
      assert.equal(url, "https://agent.example/api/agents/v1/heartbeat");
      assert.equal(init?.method, "POST");
      assert.ok(init?.signal instanceof AbortSignal);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: "pong" }),
      } as Response;
    },
  });

  const result = await client.request("heartbeat", {});
  assert.deepEqual(result, { ok: true, data: "pong" });
});

test("request times out when the transport stalls", async () => {
  const client = makeClient({
    timeoutMs: 25,
    fetch: async (_url, init) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal.reason ?? Object.assign(new Error("aborted by timeout"), { name: "AbortError" }));
        }, { once: true });
      });
      throw new Error("should not resolve");
    },
  });

  await assert.rejects(
    () => client.request("heartbeat", {}),
    (error: unknown) => {
      assert.equal((error as Error).name, "TimeoutError");
      assert.match((error as Error).message, /heartbeat.*25ms/i);
      return true;
    },
  );
});

test("caller-supplied abort signal cancels the request", async () => {
  const controller = new AbortController();
  const client = makeClient({
    fetch: async (_url, init) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal.reason ?? Object.assign(new Error("caller aborted"), { name: "AbortError" }));
        }, { once: true });
      });
      throw new Error("should not resolve");
    },
  });

  const promise = client.request("heartbeat", {}, undefined, controller.signal);
  controller.abort();

  await assert.rejects(promise, { name: "AbortError" });
});
