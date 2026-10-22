import test from "node:test";
import assert from "node:assert/strict";
import {
  THEME_STORAGE_KEY,
  Theme,
  parseTheme,
  handleThemeStorageEvent,
  applyTheme,
} from "@/lib/theme";

test("THEME_STORAGE_KEY is mimir-theme", () => {
  assert.equal(THEME_STORAGE_KEY, "mimir-theme");
});

test("parseTheme validates light, dark and invalid values", () => {
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme(""), null);
  assert.equal(parseTheme("blue"), null);
  assert.equal(parseTheme(null), null);
  assert.equal(parseTheme(undefined), null);
});

test("handleThemeStorageEvent ignores unrelated storage keys", () => {
  let calledWith: Theme | null = null;
  const result = handleThemeStorageEvent(
    { key: "unrelated-key", newValue: "light" },
    (theme) => {
      calledWith = theme;
    }
  );

  assert.equal(result, null);
  assert.equal(calledWith, null);
});

test("handleThemeStorageEvent applies light theme and triggers callback", () => {
  // Mock global document if running in node environment without DOM
  const originalDocument = globalThis.document;
  const mockDataset: Record<string, string> = { theme: "dark" };
  // @ts-expect-error mock document
  globalThis.document = {
    documentElement: {
      dataset: mockDataset,
    },
  };

  try {
    let callbackTheme: Theme | null = null;
    const result = handleThemeStorageEvent(
      { key: THEME_STORAGE_KEY, newValue: "light" },
      (theme) => {
        callbackTheme = theme;
      }
    );

    assert.equal(result, "light");
    assert.equal(callbackTheme, "light");
    assert.equal(mockDataset.theme, "light");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("handleThemeStorageEvent applies dark theme and triggers callback", () => {
  const originalDocument = globalThis.document;
  const mockDataset: Record<string, string> = { theme: "light" };
  // @ts-expect-error mock document
  globalThis.document = {
    documentElement: {
      dataset: mockDataset,
    },
  };

  try {
    let callbackTheme: Theme | null = null;
    const result = handleThemeStorageEvent(
      { key: THEME_STORAGE_KEY, newValue: "dark" },
      (theme) => {
        callbackTheme = theme;
      }
    );

    assert.equal(result, "dark");
    assert.equal(callbackTheme, "dark");
    assert.equal(mockDataset.theme, "dark");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("handleThemeStorageEvent falls back to system theme when storage value is cleared or invalid", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const mockDataset: Record<string, string> = { theme: "dark" };

  // @ts-expect-error mock document
  globalThis.document = {
    documentElement: {
      dataset: mockDataset,
    },
  };

  // Mock window.matchMedia to prefer light
  // @ts-expect-error mock window
  globalThis.window = {
    matchMedia: (query: string) => ({
      matches: query.includes("light"),
    }),
  };

  try {
    let callbackTheme: Theme | null = null;
    const result = handleThemeStorageEvent(
      { key: THEME_STORAGE_KEY, newValue: null },
      (theme) => {
        callbackTheme = theme;
      }
    );

    assert.equal(result, "light");
    assert.equal(callbackTheme, "light");
    assert.equal(mockDataset.theme, "light");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("applyTheme safely handles environment without document", () => {
  const originalDocument = globalThis.document;
  // @ts-expect-error simulate non-DOM environment
  delete globalThis.document;

  try {
    assert.doesNotThrow(() => {
      applyTheme("light");
    });
  } finally {
    globalThis.document = originalDocument;
  }
});
