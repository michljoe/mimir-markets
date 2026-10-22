/**
 * tests/node/evidence-inspector-a11y.test.ts
 *
 * Regression coverage for the EvidenceInspector disclosure (#522).
 *
 * `components/EvidenceInspector.tsx` renders a header `<button>` that toggles
 * the "Oracle Reasoning Trace" panel. Before this change the button carried no
 * `aria-expanded` and no `aria-controls`, the expanded panel had no id and no
 * label, and the chevron icons were announced as content — so a screen-reader
 * user could not tell whether the panel was open, nor which region the button
 * controlled.
 *
 * The node suite has no DOM, so this file guards the wiring that is easy to
 * regress silently: the button/panel id pairing, the disclosure state and the
 * decorative icons. Manual keyboard/screen-reader verification is described
 * in the pull request.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const inspector = read("components/EvidenceInspector.tsx");

const countOf = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

/* ── Disclosure state ──────────────────────────────────────────────────────── */

test("the toggle button exposes the disclosure state", () => {
  // Before: the button had no `aria-expanded`, so assistive tech had no way
  // to tell whether the reasoning trace was expanded.
  assert.match(inspector, /aria-expanded=\{open\}/);
});

test("the toggle button points at the panel it controls", () => {
  assert.match(inspector, /aria-controls=\{panelId\}/);
});

test("the panel is a labelled region with the id the button controls", () => {
  assert.match(inspector, /id=\{panelId\}/);
  assert.match(inspector, /role="region"/);
  assert.match(inspector, /aria-labelledby=\{buttonId\}/);
});

/* ── Id pairing ────────────────────────────────────────────────────────────── */

test("the ids come from useId so several inspectors cannot collide", () => {
  assert.match(inspector, /useId\(\)/);
  assert.match(inspector, /const buttonId = `evidence-inspector-toggle-\$\{instanceId\}`/);
  assert.match(inspector, /const panelId = `evidence-inspector-panel-\$\{instanceId\}`/);
});

test("the button carries the id the panel is labelled by", () => {
  assert.match(inspector, /id=\{buttonId\}/);
});

test("the React id colons are stripped so the ids stay selector-safe", () => {
  assert.match(inspector, /useId\(\)\.replace\(\/:\/g, ""\)/);
});

/* ── Decoration ────────────────────────────────────────────────────────────── */

test("the chevron icons are hidden from assistive technology", () => {
  // Before: `ChevronUp` / `ChevronDown` were read out as content, adding noise
  // to the button's accessible name.
  assert.match(inspector, /<ChevronUp className="h-4 w-4 text-pv-muted" aria-hidden \/>/);
  assert.match(inspector, /<ChevronDown className="h-4 w-4 text-pv-muted" aria-hidden \/>/);
});

test("the panel keeps its decorative shield hidden as well", () => {
  assert.match(inspector, /<ShieldCheck className="h-4 w-4 text-pv-emerald" aria-hidden \/>/);
});

/* ── Keyboard focus ────────────────────────────────────────────────────────── */

test("the toggle button keeps a visible focus ring", () => {
  // `focus-ring` is the shared utility from app/globals.css, already used by
  // components/ui/Button.tsx.
  assert.match(inspector, /transition-colors focus-ring"/);
});

test("the focus ring utility still exists in the global stylesheet", () => {
  const globals = read("app/globals.css");
  assert.match(globals, /\.focus-ring\s*\{/);
});

/* ── No visual change beyond the focus ring ────────────────────────────────── */

test("the panel markup and copy are otherwise untouched", () => {
  // The only class change on the button is the focus ring; the panel keeps its
  // original spacing classes.
  assert.equal(countOf(inspector, "border-t border-pv-ink/[0.06] px-4 pb-4 pt-3 space-y-4"), 1);
  assert.equal(
    inspector.includes("border-t border-pv-ink/[0.06] px-4 pb-4 pt-3 space-y-4 focus-ring"),
    false,
    "the focus ring belongs on the button, not on the panel",
  );
});
