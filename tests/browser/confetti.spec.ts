import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import ts from "typescript";

const requireDependency = createRequire(join(process.cwd(), "package.json"));
const component = ts.transpileModule(
  readFileSync(join(process.cwd(), "components/Confetti.tsx"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;

type HarnessWindow = typeof window & {
  confetti: {
    render: (active: boolean) => void;
    unmount: () => void;
    randomCalls: () => number;
    listenerCount: () => number;
  };
};

// Mount the real component and React effects without wallet or app services.
async function mountConfetti(page: Page, active = true, matchMedia = true) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="confetti-root"></div>');
  for (const dependency of ["react", "react-dom"]) {
    await page.addScriptTag({
      path: join(
        dirname(requireDependency.resolve(dependency)),
        "umd",
        `${dependency}.development.js`,
      ),
    });
  }
  await page.addScriptTag({ content: `(() => {
    const listeners = new Set();
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = ${matchMedia} ? (query) => {
      const mediaQuery = originalMatchMedia(query);
      const add = mediaQuery.addEventListener.bind(mediaQuery);
      const remove = mediaQuery.removeEventListener.bind(mediaQuery);
      mediaQuery.addEventListener = (type, listener) => {
        if (type === "change") listeners.add(listener);
        add(type, listener);
      };
      mediaQuery.removeEventListener = (type, listener) => {
        if (type === "change") listeners.delete(listener);
        remove(type, listener);
      };
      return mediaQuery;
    } : undefined;
    const exports = {};
    const require = () => React;
    ${component}
    const root = ReactDOM.createRoot(document.getElementById("confetti-root"));
    let randomCalls = 0;
    Math.random = () => { randomCalls++; return 0.5; };
    window.confetti = {
      render: (active) => ReactDOM.flushSync(() => {
        root.render(React.createElement(exports.default, { active }));
      }),
      unmount: () => ReactDOM.flushSync(() => root.unmount()),
      randomCalls: () => randomCalls,
      listenerCount: () => listeners.size,
    };
    window.confetti.render(${active});
  })();` });
  // Let passive effects and their state updates settle before absence checks.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(errors).toEqual([]);
  return errors;
}

const particles = "#confetti-root > div > div";

test("inactive confetti creates no particles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mountConfetti(page, false);
  await expect(page.locator(particles)).toHaveCount(0);
  expect(await page.evaluate(() => (window as HarnessWindow).confetti.randomCalls())).toBe(0);
});

test("default motion renders 50 particles with valid positions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = await mountConfetti(page);
  await expect(page.locator(particles)).toHaveCount(50);
  const positions = await page.locator(particles).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).style.left),
  );
  expect(positions.every((position) => position === "50%")).toBe(true);
  expect(errors).toEqual([]);
});

test("initial reduced motion skips particle creation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mountConfetti(page);
  await expect(page.locator(particles)).toHaveCount(0);
  expect(await page.evaluate(() => (window as HarnessWindow).confetti.randomCalls())).toBe(0);
});

test("preference changes work in both directions and listeners are cleaned up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await mountConfetti(page);
  expect(await page.evaluate(() => (window as HarnessWindow).confetti.listenerCount())).toBe(1);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(particles)).toHaveCount(50);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(particles)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(particles)).toHaveCount(50);
  await page.evaluate(() => (window as HarnessWindow).confetti.render(false));
  await expect(page.locator(particles)).toHaveCount(0);
  await page.evaluate(() => (window as HarnessWindow).confetti.render(true));
  await expect(page.locator(particles)).toHaveCount(50);
  await page.evaluate(() => (window as HarnessWindow).confetti.unmount());
  expect(await page.evaluate(() => (window as HarnessWindow).confetti.listenerCount())).toBe(0);
  expect(errors).toEqual([]);
});

test("missing matchMedia keeps the default animation", async ({ page }) => {
  const errors = await mountConfetti(page, true, false);
  await expect(page.locator(particles)).toHaveCount(50);
  expect(errors).toEqual([]);
});
