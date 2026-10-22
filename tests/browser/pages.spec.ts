/**
 * Page smoke: the public surface renders on a cold, unconfigured build.
 *
 * Every route here must produce a rendered page — a `main` region and its
 * signature heading — and must not throw an uncaught page error. The smoke
 * build has no database, no contract ids and no secrets, so these tests pin
 * the "fail closed and still serve UI" contract: a page that 500s, blanks
 * out, or leaks a client exception fails here.
 *
 * ── ARIA snapshots ───────────────────────────────────────────────────────────
 *
 * Key UI regions are pinned with `expect(locator).toMatchAriaSnapshot()` so
 * accessibility regressions in landmarks, headings and form labels are caught
 * without new dependencies. Snapshots live in `tests/browser/__snapshots__/`.
 *
 * To update snapshots after an intentional UI change:
 *   npm run smoke:browser -- --update-snapshots
 *
 * Snapshots are scoped to structural elements (landmarks, regions, form
 * controls) so cosmetic text edits do not break them.
 */

import { expect, test } from "@playwright/test";

import { expectMainLandmark, trackPageErrors } from "./helpers";

const PUBLIC_PAGES: ReadonlyArray<readonly [string, RegExp]> = [
  // Locale home: the hero headline.
  ["/en/", /don't argue/i],
  // Arena feed: DB-less build serves the empty arena, not a crash.
  ["/en/explorer", /ready to challenge/i],
  ["/en/stats", /live on-chain stats/i],
  ["/en/dashboard", /connect your wallet/i],
  ["/en/council", /twenty ai frames/i],
  ["/en/agents", /ai agents and humans/i],
  ["/en/baskets", /agent baskets/i],
  ["/en/revenue", /agent revenue/i],
  ["/en/vs/create", /set the terms and initialize challenge/i],
  ["/en/emerging-narratives", /emerging narratives/i],
  ["/en/docs", /how mimir works/i],
];

for (const [route, heading] of PUBLIC_PAGES) {
  test(`renders ${route}`, async ({ page }) => {
    const errors: string[] = [];
    trackPageErrors(page, errors);

    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expectMainLandmark(page);

    // Signature heading (may be client-rendered; Playwright polls for it).
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();

    if (route !== "/en/") {
      const connectButton = page
        .getByRole("banner")
        .getByRole("button", { name: "Connect", exact: true });
      await expect(connectButton).toBeVisible();
      await expect(connectButton).toHaveAccessibleName("Connect");
    }

    // The page is real content, not a blank shell.
    const bodyLength = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLength).toBeGreaterThan(200);

    expect(errors).toEqual([]);
  });
}

test.describe("ARIA snapshots", () => {
  test("header/nav landmark structure", async ({ page }) => {
    const errors: string[] = [];
    trackPageErrors(page, errors);

    await page.goto("/en/explorer", { waitUntil: "domcontentloaded" });
    await expectMainLandmark(page);

    // Pin the accessible structure of the header landmark: nav region, theme
    // toggle, and the connect control. Cosmetic text changes inside these
    // regions do not break the snapshot because only the landmark, roles and
    // accessible names are compared.
    await expect(page.getByRole("banner")).toMatchAriaSnapshot();

    expect(errors).toEqual([]);
  });

  test("/en/explorer filter controls structure", async ({ page }) => {
    const errors: string[] = [];
    trackPageErrors(page, errors);

    await page.goto("/en/explorer", { waitUntil: "domcontentloaded" });
    await expectMainLandmark(page);

    // Pin the filter control region: sort listbox, quick-filter listbox, min
    // stake input, search input, and the advanced toggle. A removed label or
    // control here fails the snapshot.
    const filtersRegion = page
      .locator("#arena-controls")
      .or(page.locator('[aria-label*="filter" i]'))
      .first();
    await expect(filtersRegion).toMatchAriaSnapshot();

    expect(errors).toEqual([]);
  });

  test("/en/vs/create first step form labels", async ({ page }) => {
    const errors: string[] = [];
    trackPageErrors(page, errors);

    await page.goto("/en/vs/create", { waitUntil: "domcontentloaded" });
    await expectMainLandmark(page);

    // Pin the accessible structure of the create form's first step: the
    // question textarea, side A/B inputs, visibility toggle, stake presets,
    // and deadline presets. Only landmarks, form labels and control names are
    // compared, so cosmetic copy edits do not break the snapshot.
    const formRegion = page.locator("main").first();
    await expect(formRegion).toMatchAriaSnapshot();

    expect(errors).toEqual([]);
  });

  test("wallet modal structure via the wallet mock", async ({ page }) => {
    const errors: string[] = [];
    trackPageErrors(page, errors);

    await page.goto("/en/explorer", { waitUntil: "domcontentloaded" });
    await expectMainLandmark(page);

    // Open the wallet picker and pin the dialog's accessible structure:
    // title, network line, wallet rows, and the fallback "Don't have one?"
    // details. The roster is deterministic on the smoke build.
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Connect", exact: true })
      .click();

    const dialog = page.getByRole("dialog", { name: "Connect wallet" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toMatchAriaSnapshot();

    // Dismiss and leave the page intact.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    expect(errors).toEqual([]);
  });
});
