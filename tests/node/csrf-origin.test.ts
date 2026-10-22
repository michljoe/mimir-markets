import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRequest } from "../../lib/api/policy";
import { verifyBrowserOrigin } from "../../lib/api/origin";
import { NextRequest } from "next/server";

/**
 * CSRF and origin regression tests for API routes and signed actions.
 *
 * Rollback: do not disable origin validation for 'authenticated_user' tier.
 * It is required to prevent cross-site request forgery when wallets are
 * making mutating calls. If agents need to bypass this, they must use
 * 'registered_agent' tier with signed actions instead.
 */

test("positive: browser-origin policy enforces exact origin match for mutating user requests", async () => {
  const result = await authorizeRequest("authenticated_user", {
    route: "/api/test",
    mutatesValue: true,
    wallet: "GABC",
    idempotencyKey: "key",
    originValid: true,
  });
  assert.equal(result.allowed, true);
});

test("negative: mutating request fails if origin is invalid or cross-origin", async () => {
  const result = await authorizeRequest("authenticated_user", {
    route: "/api/test",
    mutatesValue: true,
    wallet: "GABC",
    idempotencyKey: "key",
    originValid: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.error?.status, 403);
  assert.match(result.error?.body.error.message ?? "", /cross-origin mutations are not allowed/);
});

test("boundary: public read requests do not require origin validation even from browser", async () => {
  const result = await authorizeRequest("public_read", {
    route: "/api/test",
    mutatesValue: false,
  });
  assert.equal(result.allowed, true);
});

test("boundary: signed agent actions bypass browser-origin checks", async () => {
  const result = await authorizeRequest("registered_agent", {
    route: "/api/test",
    mutatesValue: true,
    wallet: "GABC",
    agentId: "agent-1",
    signatureVerified: true,
    idempotencyKey: "key",
    // originValid is false (or undefined) because agents do not send Origin
    originValid: false,
  });
  assert.equal(result.allowed, true);
});

test("regression: verifyBrowserOrigin rejects mismatched origins", async () => {
  // Mock NextRequest for identical host/origin
  const reqMatch = new NextRequest("http://mimir.example.com/api/test", {
    method: "POST",
    headers: {
      "origin": "http://mimir.example.com",
      "host": "mimir.example.com",
    },
  });
  assert.equal(verifyBrowserOrigin(reqMatch), true);

  // Cross-origin
  const reqMismatch = new NextRequest("http://mimir.example.com/api/test", {
    method: "POST",
    headers: {
      "origin": "http://evil.com",
      "host": "mimir.example.com",
    },
  });
  assert.equal(verifyBrowserOrigin(reqMismatch), false);

  // Missing origin on POST
  const reqMissing = new NextRequest("http://mimir.example.com/api/test", {
    method: "POST",
    headers: {
      "host": "mimir.example.com",
    },
  });
  assert.equal(verifyBrowserOrigin(reqMissing), false);
});
