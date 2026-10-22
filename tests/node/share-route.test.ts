import Module from "node:module";

// Stub Next.js "server-only" guard before requiring the route module
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.apply(this, arguments);
};

import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import type { ClaimData } from "../../lib/contract";
import type { ShareCardInput } from "../../lib/share-card";

const { GET, setClaimLoaderForTesting } = require("../../app/api/share/[id]/route");

const SECRET_QUESTION = "Secret confidential prediction question: will XYZ happen?";
const SECRET_POSITION_A = "Secret Position YES";
const SECRET_POSITION_B = "Secret Position NO";
const SECRET_URL = "https://confidential-leak.com/proof";

function mockClaim(overrides: Partial<ClaimData> = {}): ClaimData {
  return {
    id: 42,
    creator: "GBMGZBFKUNOS7JWPRPF5IMZR27DCR6BEP6SQVFV2I354UPY35FZTIR2Y",
    first_challenger: "GAXDYF5D77N7N3C5F3Q3EHY6Z4X6P536K2WUVB7ZGFZ4RTHM6QO3V2AA",
    question: SECRET_QUESTION,
    creator_position: SECRET_POSITION_A,
    counter_position: SECRET_POSITION_B,
    resolution_url: SECRET_URL,
    creator_stake: 50,
    total_challenger_stake: 50,
    reserved_creator_liability: 50,
    available_creator_liability: 0,
    total_pot: 100,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    state: "open",
    winner_side: "",
    resolution_summary: "",
    confidence: 0,
    category: "crypto",
    parent_id: 0,
    challenger_count: 1,
    market_type: "binary",
    odds_mode: "pool",
    challenger_payout_bps: 20000,
    handicap_line: "",
    settlement_rule: "",
    max_challengers: 10,
    is_private: false,
    visibility: "public",
    ...overrides,
  };
}

function makeRequest(path = "http://localhost/api/share/42"): Request {
  return new Request(path, { method: "GET" });
}

beforeEach(() => {
  setClaimLoaderForTesting(null);
});

afterEach(() => {
  setClaimLoaderForTesting(null);
});

// ── Privacy & Guard Tests ─────────────────────────────────────────────────────

test("private claim with is_private=true renders locked placeholder and leaks no content", async () => {
  let capturedInput: ShareCardInput | null = null;
  const privateClaim = mockClaim({ is_private: true, visibility: "public" });

  const deps = {
    readClaim: async () => privateClaim,
    buildCard: (input: ShareCardInput, size?: any) => {
      capturedInput = input;
      const { buildShareCard } = require("../../lib/share-card");
      return buildShareCard(input, size);
    },
  };

  const req = makeRequest("http://localhost/api/share/42");
  const res = await GET(req, { params: Promise.resolve({ id: "42" }) }, deps);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");

  // Assert card input guard: isPrivate must be true
  assert.ok(capturedInput, "buildCard must have been invoked");
  assert.equal((capturedInput as ShareCardInput).isPrivate, true, "isPrivate guard must evaluate to true");

  const svg = await res.text();

  // Confidential information must never leak into the SVG output
  assert.equal(svg.includes(SECRET_QUESTION), false, "Question leaked into SVG");
  assert.equal(svg.includes(SECRET_POSITION_A), false, "Creator position leaked into SVG");
  assert.equal(svg.includes(SECRET_POSITION_B), false, "Counter position leaked into SVG");
  assert.equal(svg.includes("confidential-leak.com"), false, "Resolution domain leaked into SVG");
  assert.equal(svg.includes("100 USDC"), false, "Pot amount leaked into SVG");

  // Locked placeholder content must be present
  assert.ok(svg.includes("Private claim on Mimir"), "Private title placeholder missing");
  assert.ok(svg.includes("Invite only"), "Invite only placeholder missing");
  assert.ok(svg.includes("#8A9391"), "Muted/locked accent bar color missing");
});

test("private claim with visibility='private' renders locked placeholder and leaks no content", async () => {
  let capturedInput: ShareCardInput | null = null;
  const privateClaim = mockClaim({ is_private: false, visibility: "private" });

  const deps = {
    readClaim: async () => privateClaim,
    buildCard: (input: ShareCardInput, size?: any) => {
      capturedInput = input;
      const { buildShareCard } = require("../../lib/share-card");
      return buildShareCard(input, size);
    },
  };

  const req = makeRequest("http://localhost/api/share/42");
  const res = await GET(req, { params: Promise.resolve({ id: "42" }) }, deps);

  assert.equal(res.status, 200);
  assert.ok(capturedInput);
  assert.equal((capturedInput as ShareCardInput).isPrivate, true, "visibility='private' must activate isPrivate guard");

  const svg = await res.text();
  assert.equal(svg.includes(SECRET_QUESTION), false);
  assert.equal(svg.includes(SECRET_POSITION_A), false);
  assert.equal(svg.includes(SECRET_POSITION_B), false);
  assert.ok(svg.includes("Private claim on Mimir"));
  assert.ok(svg.includes("Invite only"));
});

test("public claim renders normally with question, positions, and pot", async () => {
  let capturedInput: ShareCardInput | null = null;
  const publicClaim = mockClaim({ is_private: false, visibility: "public" });

  const deps = {
    readClaim: async () => publicClaim,
    buildCard: (input: ShareCardInput, size?: any) => {
      capturedInput = input;
      const { buildShareCard } = require("../../lib/share-card");
      return buildShareCard(input, size);
    },
  };

  const req = makeRequest("http://localhost/api/share/42");
  const res = await GET(req, { params: Promise.resolve({ id: "42" }) }, deps);

  assert.equal(res.status, 200);
  assert.ok(capturedInput);
  assert.equal((capturedInput as ShareCardInput).isPrivate, false, "public claim must have isPrivate=false");

  const svg = await res.text();
  assert.ok(svg.includes(SECRET_QUESTION.slice(0, 30)), "Question must appear on public card");
  assert.ok(svg.includes(SECRET_POSITION_A), "Creator position must appear on public card");
  assert.ok(svg.includes(SECRET_POSITION_B), "Counter position must appear on public card");
  assert.ok(svg.includes("confidential-leak.com"), "Source domain must appear on public card");
  assert.ok(svg.includes("100 USDC"), "Pot must appear on public card");
  assert.ok(svg.includes("#34D399"), "Public active card must have active accent bar color");
});

test("acceptance criteria: test fails if the isPrivate guard is bypassed or removed", async () => {
  // If the route's guard is removed (i.e. isPrivate is passed as false for a private claim),
  // confidential details leak to the card and this assertion must detect it and fail.
  const privateClaim = mockClaim({ is_private: true, visibility: "private" });

  // Simulate what happens without the guard: isPrivate evaluates to false
  const { buildShareCard } = require("../../lib/share-card");
  const leakedCard = buildShareCard({
    claimId: 42,
    question: privateClaim.question,
    creatorPosition: privateClaim.creator_position,
    counterPosition: privateClaim.counter_position,
    resolutionUrl: privateClaim.resolution_url,
    totalPot: privateClaim.total_pot,
    mode: { subjectType: "claim", settlementMode: "pool", label: "Pool Market" },
    deadline: privateClaim.deadline,
    state: privateClaim.state,
    isPrivate: false, // Bypassed guard
  });

  // Verify that bypassing the guard leaks private data
  assert.ok(leakedCard.title.includes("Secret confidential"), "Un-guarded card leaks question");
  assert.ok(leakedCard.sideA.includes("Secret Position YES"), "Un-guarded card leaks position A");
  assert.equal(leakedCard.locked, false, "Un-guarded card is not locked");

  // Verify the real route WITH the guard stops the leak
  const req = makeRequest("http://localhost/api/share/42");
  const res = await GET(req, { params: Promise.resolve({ id: "42" }) }, {
    readClaim: async () => privateClaim,
  });
  const secureSvg = await res.text();
  assert.equal(secureSvg.includes(SECRET_QUESTION), false, "Real route with guard must never leak question");
  assert.equal(secureSvg.includes(SECRET_POSITION_A), false, "Real route with guard must never leak position A");
});

// ── Cache Control Header Tests ────────────────────────────────────────────────

test("cache headers differ appropriately: open/active vs resolved/cancelled", async () => {
  // 1. Open / active claim: short cache (60s max-age, 300s stale-while-revalidate)
  const openRes = await GET(
    makeRequest("http://localhost/api/share/42"),
    { params: Promise.resolve({ id: "42" }) },
    { readClaim: async () => mockClaim({ state: "open" }) },
  );
  assert.equal(
    openRes.headers.get("cache-control"),
    "public, s-maxage=60, stale-while-revalidate=300",
    "Open market must have short cache-control header",
  );

  const activeRes = await GET(
    makeRequest("http://localhost/api/share/42"),
    { params: Promise.resolve({ id: "42" }) },
    { readClaim: async () => mockClaim({ state: "active" }) },
  );
  assert.equal(
    activeRes.headers.get("cache-control"),
    "public, s-maxage=60, stale-while-revalidate=300",
    "Active market must have short cache-control header",
  );

  // 2. Resolved claim: long-lived immutable cache (86400s max-age, 604800s stale-while-revalidate)
  const resolvedRes = await GET(
    makeRequest("http://localhost/api/share/42"),
    { params: Promise.resolve({ id: "42" }) },
    { readClaim: async () => mockClaim({ state: "resolved" }) },
  );
  assert.equal(
    resolvedRes.headers.get("cache-control"),
    "public, s-maxage=86400, stale-while-revalidate=604800",
    "Resolved market must have long cache-control header",
  );

  // 3. Cancelled claim: long-lived immutable cache
  const cancelledRes = await GET(
    makeRequest("http://localhost/api/share/42"),
    { params: Promise.resolve({ id: "42" }) },
    { readClaim: async () => mockClaim({ state: "cancelled" }) },
  );
  assert.equal(
    cancelledRes.headers.get("cache-control"),
    "public, s-maxage=86400, stale-while-revalidate=604800",
    "Cancelled market must have long cache-control header",
  );

  // Assert they strictly differ
  assert.notEqual(
    openRes.headers.get("cache-control"),
    resolvedRes.headers.get("cache-control"),
    "Cache control must differ between open and settled claims",
  );
});

// ── Module-Level Stubbing & Locale ───────────────────────────────────────────

test("supports setClaimLoaderForTesting module-level stubbing", async () => {
  setClaimLoaderForTesting(async () => mockClaim({ is_private: true }));

  const req = makeRequest("http://localhost/api/share/42");
  const res = await GET(req, { params: Promise.resolve({ id: "42" }) });

  assert.equal(res.status, 200);
  const svg = await res.text();
  assert.equal(svg.includes(SECRET_QUESTION), false);
  assert.ok(svg.includes("Private claim on Mimir"));
});

test("private claim honors Turkish locale parameter (?locale=tr)", async () => {
  const req = makeRequest("http://localhost/api/share/42?locale=tr");
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "42" }) },
    { readClaim: async () => mockClaim({ is_private: true }) },
  );

  assert.equal(res.status, 200);
  const svg = await res.text();
  assert.ok(svg.includes("Mimir&#39;de özel market") || svg.includes("Mimir&apos;de özel market"));
  assert.ok(svg.includes("Yalnız davetle"));
  assert.equal(svg.includes(SECRET_QUESTION), false);
});

// ── Error Handling Tests ──────────────────────────────────────────────────────

test("returns 400 for invalid claim ID", async () => {
  const resZero = await GET(
    makeRequest("http://localhost/api/share/0"),
    { params: Promise.resolve({ id: "0" }) },
  );
  assert.equal(resZero.status, 400);
  const bodyZero = await resZero.json();
  assert.equal(bodyZero.error, "invalid claim id");

  const resNegative = await GET(
    makeRequest("http://localhost/api/share/-10"),
    { params: Promise.resolve({ id: "-10" }) },
  );
  assert.equal(resNegative.status, 400);

  const resAlpha = await GET(
    makeRequest("http://localhost/api/share/abc"),
    { params: Promise.resolve({ id: "abc" }) },
  );
  assert.equal(resAlpha.status, 400);
});

test("returns 404 when claim is not found", async () => {
  const res = await GET(
    makeRequest("http://localhost/api/share/999"),
    { params: Promise.resolve({ id: "999" }) },
    { readClaim: async () => null },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "claim 999 not found");
});
