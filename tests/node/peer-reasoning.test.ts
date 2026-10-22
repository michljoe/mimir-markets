import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectPeerSellers } from "../../agents/council/shared/peer-reasoning";
import { COUNCIL_PERSONAS, type PersonaSpec } from "../../agents/council/personas";

describe("selectPeerSellers", () => {
  const personas = COUNCIL_PERSONAS;
  const buyer = personas[0]; // optimist

  it("excludes the buyer from selected peer sellers", () => {
    for (const p of personas) {
      const sellers = selectPeerSellers(p, personas, 1, 5);
      assert.equal(sellers.some((s) => s.slug === p.slug), false);
    }
  });

  it("returns all peers when fewer peers than count", () => {
    const subset: PersonaSpec[] = [personas[0], personas[1], personas[2]];
    const b = subset[0];
    const sellers = selectPeerSellers(b, subset, 10, 10);
    assert.equal(sellers.length, 2);
    assert.deepEqual(
      sellers.map((s) => s.slug).sort(),
      [subset[1].slug, subset[2].slug].sort(),
    );
    assert.equal(sellers.some((s) => s.slug === b.slug), false);
  });

  it("ensures rotation differs per claimId", () => {
    const claim1Sellers = selectPeerSellers(buyer, personas, 1, 3);
    const claim2Sellers = selectPeerSellers(buyer, personas, 2, 3);
    const claim3Sellers = selectPeerSellers(buyer, personas, 3, 3);

    const slugs1 = claim1Sellers.map((s) => s.slug);
    const slugs2 = claim2Sellers.map((s) => s.slug);
    const slugs3 = claim3Sellers.map((s) => s.slug);

    assert.notDeepEqual(slugs1, slugs2);
    assert.notDeepEqual(slugs2, slugs3);
    assert.notDeepEqual(slugs1, slugs3);
  });

  it("produces deterministic output for same inputs", () => {
    const run1 = selectPeerSellers(buyer, personas, 42, 4);
    const run2 = selectPeerSellers(buyer, personas, 42, 4);

    assert.deepEqual(
      run1.map((s) => s.slug),
      run2.map((s) => s.slug),
    );
  });
});
