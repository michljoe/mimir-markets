/**
 * docs/X402.md drift guard — every paid route must be documented.
 *
 * The x402 integration guide (docs/X402.md) is the third-party buyer contract:
 * endpoint table, 402 quote shape, proof message, freshness and replay rules.
 * A new paidRoute() call site that never reaches the doc silently leaves
 * buyers without the only written description of the scheme they are paying
 * for. This test scans every app/api route file for paidRoute("<priceKey>")
 * wrappers and asserts each one is mentioned in the guide, together with its
 * route path, its price constant name, and the wire-format invariants the doc
 * must pin exactly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const DOC = readFileSync(join(ROOT, "docs", "X402.md"), "utf8");

interface PaidRouteCallSite {
  file: string;
  method: string;
  path: string;
  priceKey: string;
}

/** Every `export const METHOD = …paidRoute("key"…)` across app/api route files. */
function collectPaidRouteCallSites(): PaidRouteCallSite[] {
  const apiRoot = join(ROOT, "app", "api");
  const sites: PaidRouteCallSite[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const source = readFileSync(full, "utf8");
      if (!source.includes("paidRoute(")) continue;
      const rel = relative(ROOT, full).split(sep).join("/");
      // app/api/<...>/route.ts → /api/<...>
      const path = "/" + rel.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
      // Exports can wrap paidRoute onto following lines (tracedRoute + options
      // blocks), so search each `export const METHOD = …` chunk, not single lines.
      const chunks = source.split(/(?=export const (?:GET|POST|PUT|PATCH|DELETE)\s*=)/);
      for (const chunk of chunks) {
        const head = /^export const (GET|POST|PUT|PATCH|DELETE)\s*=/.exec(chunk);
        const key = /paidRoute\(\s*"([A-Za-z0-9_]+)"/.exec(chunk);
        if (head && key) sites.push({ file: rel, method: head[1], path, priceKey: key[1] });
      }
    }
  };
  walk(apiRoot);
  return sites;
}

test("at least the six known paid routes exist (the scan itself works)", () => {
  const sites = collectPaidRouteCallSites();
  assert.ok(sites.length >= 6, `expected ≥6 paidRoute call sites, found ${sites.length}`);
});

test("every paidRoute call site is documented in docs/X402.md", () => {
  const missing = collectPaidRouteCallSites().filter(
    (site) => !DOC.includes(site.path) || !DOC.includes(site.priceKey),
  );
  assert.deepEqual(
    missing,
    [],
    `docs/X402.md must mention the path and price key of every paid route; missing: ${missing
      .map((s) => `${s.method} ${s.path} (PRICES.${s.priceKey}, ${s.file})`)
      .join(", ")}`,
  );
});

test("the guide pins the proof wire format exactly", () => {
  // paymentProofMessage() header line and the proof discriminator, verbatim.
  assert.ok(DOC.includes("Mimir x402 payment v1"), "proof message header line");
  assert.ok(DOC.includes('"stellar-payment-v1"'), "proof kind discriminator");
  // The message fields, in order — a rename in stellar-scheme.ts must fail here.
  const fields = ["network: ", "transaction: ", "payTo: ", "amount: ", "asset: "];
  const headerAt = DOC.indexOf("Mimir x402 payment v1");
  let cursor = headerAt;
  for (const field of fields) {
    const at = DOC.indexOf(field, cursor);
    assert.ok(at > -1, `proof message must document the \`${field.trim()}\` field`);
    cursor = at;
  }
});

test("the guide names the freshness window and the kill switch", () => {
  assert.ok(DOC.includes("X402_PAYMENT_MAX_AGE_MS"), "freshness constant");
  assert.ok(DOC.includes("x402_selling"), "seller kill-switch capability");
  assert.ok(DOC.includes("already_settled"), "replay refusal reason");
  assert.ok(DOC.includes("/api/council/subscribe"), "council pass route");
  assert.ok(DOC.includes("fetchWithBudget"), "buyer example uses lib/x402/buyer.ts");
});
