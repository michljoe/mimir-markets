import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ListboxField, {
  findTypeAheadListboxIndex,
  getListboxOptionId,
  getSelectedListboxIndex,
  isListboxTypeAheadKey,
  reduceListboxKeyAction,
  reduceListboxKeyIndex,
} from "../../components/ui/ListboxField";
import type { ListboxFieldOption } from "../../components/ui/ListboxField";

const SAMPLE_OPTIONS: ListboxFieldOption[] = [
  { value: "newest", label: "Newest first" },
  { value: "closing_soon", label: "Closing soon" },
  { value: "crypto", label: "Crypto" },
  { value: "culture", label: "Culture" },
  { value: "sports", label: "Sports" },
];

// ── Key-to-index reducer (pure helper) ──────────────────────────────────────

test("reduceListboxKeyIndex moves down with ArrowDown and clamps at the last option", () => {
  assert.equal(reduceListboxKeyIndex(0, "ArrowDown", SAMPLE_OPTIONS), 1);
  assert.equal(reduceListboxKeyIndex(3, "ArrowDown", SAMPLE_OPTIONS), 4);
  assert.equal(reduceListboxKeyIndex(4, "ArrowDown", SAMPLE_OPTIONS), 4);
});

test("reduceListboxKeyIndex moves up with ArrowUp and clamps at the first option", () => {
  assert.equal(reduceListboxKeyIndex(4, "ArrowUp", SAMPLE_OPTIONS), 3);
  assert.equal(reduceListboxKeyIndex(1, "ArrowUp", SAMPLE_OPTIONS), 0);
  assert.equal(reduceListboxKeyIndex(0, "ArrowUp", SAMPLE_OPTIONS), 0);
});

test("reduceListboxKeyIndex jumps to first and last option on Home and End", () => {
  assert.equal(reduceListboxKeyIndex(3, "Home", SAMPLE_OPTIONS), 0);
  assert.equal(reduceListboxKeyIndex(0, "End", SAMPLE_OPTIONS), 4);
});

test("reduceListboxKeyIndex supports case-insensitive first-letter type-ahead and cycles matches", () => {
  // Starting at index 0 ("Newest first"), typing "c" jumps to index 1 ("Closing soon")
  const firstC = reduceListboxKeyIndex(0, "c", SAMPLE_OPTIONS);
  assert.equal(firstC, 1);

  // Typing "C" again cycles to index 2 ("Crypto")
  const secondC = reduceListboxKeyIndex(firstC, "C", SAMPLE_OPTIONS);
  assert.equal(secondC, 2);

  // Typing "c" again cycles to index 3 ("Culture")
  const thirdC = reduceListboxKeyIndex(secondC, "c", SAMPLE_OPTIONS);
  assert.equal(thirdC, 3);

  // Typing "c" again wraps around to index 1 ("Closing soon")
  const wrappedC = reduceListboxKeyIndex(thirdC, "c", SAMPLE_OPTIONS);
  assert.equal(wrappedC, 1);
});

test("reduceListboxKeyIndex keeps current index when type-ahead letter matches no option", () => {
  assert.equal(reduceListboxKeyIndex(2, "z", SAMPLE_OPTIONS), 2);
});

test("reduceListboxKeyIndex ignores modified keys and non-navigation keys", () => {
  assert.equal(
    reduceListboxKeyIndex(0, "c", SAMPLE_OPTIONS, { ctrlKey: true }),
    0
  );
  assert.equal(
    reduceListboxKeyIndex(0, "c", SAMPLE_OPTIONS, { metaKey: true }),
    0
  );
  assert.equal(
    reduceListboxKeyIndex(0, "c", SAMPLE_OPTIONS, { altKey: true }),
    0
  );
  assert.equal(reduceListboxKeyIndex(2, "Shift", SAMPLE_OPTIONS), 2);
  assert.equal(reduceListboxKeyIndex(2, " ", SAMPLE_OPTIONS), 2);
  assert.equal(isListboxTypeAheadKey(" "), false);
  assert.equal(isListboxTypeAheadKey("Enter"), false);
  assert.equal(isListboxTypeAheadKey("a"), true);
});

test("reduceListboxKeyIndex handles empty options and out-of-range indices", () => {
  assert.equal(reduceListboxKeyIndex(0, "ArrowDown", []), -1);
  assert.equal(reduceListboxKeyIndex(0, "Home", []), -1);
  assert.equal(findTypeAheadListboxIndex([], 0, "a"), -1);
  assert.equal(reduceListboxKeyIndex(-1, "ArrowDown", SAMPLE_OPTIONS), 0);
  assert.equal(reduceListboxKeyIndex(-1, "ArrowUp", SAMPLE_OPTIONS), 0);
});

// ── Selected index and option id helpers ────────────────────────────────────

test("getSelectedListboxIndex returns matching index or falls back to 0", () => {
  assert.equal(getSelectedListboxIndex(SAMPLE_OPTIONS, "crypto"), 2);
  assert.equal(getSelectedListboxIndex(SAMPLE_OPTIONS, "unknown"), 0);
  assert.equal(getSelectedListboxIndex([], "crypto"), -1);
});

test("getListboxOptionId produces deterministic option ids", () => {
  assert.equal(getListboxOptionId("sort-r1", 2), "sort-r1-option-2");
  assert.equal(getListboxOptionId("sort-r1", -1), "");
});

// ── Full keyboard action reducer ────────────────────────────────────────────

test("reduceListboxKeyAction opens from closed trigger on ArrowDown, ArrowUp, Enter, Space, Home, and End", () => {
  const closedState = {
    open: false,
    activeIndex: 2,
    value: "crypto",
    options: SAMPLE_OPTIONS,
  };

  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    const action = reduceListboxKeyAction(closedState, key);
    assert.equal(action.type, "open");
    assert.equal(action.open, true);
    assert.equal(action.activeIndex, 2);
    assert.equal(action.preventDefault, true);
  }

  const homeOpen = reduceListboxKeyAction(closedState, "Home");
  assert.equal(homeOpen.type, "open");
  assert.equal(homeOpen.activeIndex, 0);

  const endOpen = reduceListboxKeyAction(closedState, "End");
  assert.equal(endOpen.type, "open");
  assert.equal(endOpen.activeIndex, SAMPLE_OPTIONS.length - 1);
});

test("reduceListboxKeyAction selects the active option and returns focus on Enter or Space when open", () => {
  const openState = {
    open: true,
    activeIndex: 3,
    value: "newest",
    options: SAMPLE_OPTIONS,
  };

  for (const key of ["Enter", " "]) {
    const action = reduceListboxKeyAction(openState, key);
    assert.equal(action.type, "select");
    if (action.type === "select") {
      assert.equal(action.selectedValue, "culture");
    }
    assert.equal(action.open, false);
    assert.equal(action.returnFocus, true);
    assert.equal(action.preventDefault, true);
  }
});

test("reduceListboxKeyAction closes on Escape and returns focus to trigger without changing selection", () => {
  const openState = {
    open: true,
    activeIndex: 4,
    value: "crypto",
    options: SAMPLE_OPTIONS,
  };

  const action = reduceListboxKeyAction(openState, "Escape");
  assert.equal(action.type, "close");
  assert.equal(action.open, false);
  assert.equal(action.activeIndex, 2);
  assert.equal(action.returnFocus, true);
  assert.equal(action.preventDefault, true);
});

test("reduceListboxKeyAction closes on Tab without trapping focus", () => {
  const openState = {
    open: true,
    activeIndex: 1,
    value: "newest",
    options: SAMPLE_OPTIONS,
  };

  const action = reduceListboxKeyAction(openState, "Tab");
  assert.equal(action.type, "close");
  assert.equal(action.open, false);
  assert.equal(action.preventDefault, false);
  assert.equal(action.returnFocus, false);
});

// ── Component ARIA wiring & SSR markup ──────────────────────────────────────

test("ListboxField renders trigger with aria-expanded, aria-controls, and aria-haspopup", () => {
  const markup = renderToStaticMarkup(
    createElement(ListboxField, {
      id: "market-category",
      label: "Category",
      value: "crypto",
      options: SAMPLE_OPTIONS,
      onChange: () => {},
    })
  );

  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-haspopup="listbox"/);
  assert.match(markup, /aria-controls="market-category-[^"]+-listbox"/);
  assert.match(markup, />Crypto<\/span>/);
});

test("ListboxField wires aria-activedescendant, aria-selected, and focus return in component source", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ui/ListboxField.tsx"),
    "utf8"
  );

  assert.match(source, /aria-activedescendant=\{activeOptionId\}/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-selected=\{isSelected\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{listboxId\}/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
});
