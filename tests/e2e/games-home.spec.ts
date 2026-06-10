import { expect, type Page, test } from "@playwright/test";
import { disableAutoDevSignIn, signInAsDev } from "./helpers";

// G1b (issue #284): Games home happy path with EXPO_PUBLIC_ENABLE_GAMES on
// (scripts/e2e.sh exports it) — add a game by URL, paste a result onto
// today's card, add a second game and drag-reorder, then verify the order
// survives a reload and the per-game board shows the day rail.
//
// Unique hostnames per run, and every assertion is scoped to this run's
// cards, so re-running against a dirty dev DB (the dev user may already
// have games) doesn't conflict with prior state.

test("games home: add by URL → paste result → reorder persists → board", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  // Sign-in lands on the Lists home; flip to the Games surface via the
  // web sidebar switch (same affordance games-tab.spec.ts covers).
  await signInAsDev(page, { displayName: "E2E Games Player" });
  await page.getByTestId("tab-switch-games").click();
  await expect(page.getByTestId("games-home")).toBeVisible();

  const run = Date.now();
  const hostA = `e2e-alpha-${run}.example.com`;
  const hostB = `e2e-beta-${run}.example.com`;

  // Add the first game via the FAB → add-by-URL sheet. Unknown URLs get a
  // hostname title (spec §3.3), which is what the card should show.
  await page.getByTestId("fab-add-game").click();
  await page.getByTestId("add-game-url-input").fill(`https://${hostA}/daily`);
  await page.getByTestId("add-game-submit").click();
  await expect(cardBody(page, hostA)).toBeVisible();
  const idA = await cardIdFor(page, hostA);
  const cardA = page.getByTestId(`game-card-${idA}`);

  // Unplayed: the new card offers the paste affordance. Paste a result.
  await page.getByTestId(`game-card-paste-${idA}`).click();
  await expect(page.getByTestId("game-paste-sheet")).toBeVisible();
  await page.getByTestId("game-paste-input").fill("Daily #12\n🟩🟩🟨\nScore: 42");
  await page.getByTestId("game-paste-submit").click();

  // The result lands on today's card: my row renders the distilled score
  // and the turnout flips to played.
  await expect(cardA.locator('[data-testid^="game-card-score-"]')).toContainText("Score: 42");
  await expect(cardA.getByText("You've played today")).toBeVisible();

  // Add a second game → it appends after the first.
  await page.getByTestId("fab-add-game").click();
  await page.getByTestId("add-game-url-input").fill(hostB);
  await page.getByTestId("add-game-submit").click();
  await expect(cardBody(page, hostB)).toBeVisible();
  const idB = await cardIdFor(page, hostB);
  expect(await cardOrder(page, idA, idB)).toBe("A-first");

  // Two overlays can swallow the drag's mousedown: the add sheet's RN Modal
  // (mounted through its ~220ms exit animation) and the bottom-anchored
  // "Added …" toast (3.5s), which covers the last card exactly where this
  // run's cards sit. Wait both out before dragging.
  await expect(page.getByTestId("add-game-sheet")).toBeHidden();
  await expect(page.getByText(`Added ${hostB}`)).toBeHidden({ timeout: 10_000 });

  // Drag B's card above A's (dnd-kit MouseSensor, 4px activation distance —
  // move in steps so the sensor sees the motion). The dev user may already
  // have games, putting this run's cards below the fold — mouse events
  // outside the viewport silently miss, so scroll them into view first.
  // The reordered UI is optimistic, so also await the move round-trip
  // before reloading.
  await cardBody(page, hostA).scrollIntoViewIfNeeded();
  const from = await cardBody(page, hostB).boundingBox();
  const to = await cardBody(page, hostA).boundingBox();
  if (!from || !to) throw new Error("card bounding boxes unavailable");
  const moveDone = page.waitForResponse(
    (res) => res.url().includes("/move") && res.request().method() === "POST",
  );
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
  await page.waitForTimeout(100);
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.up();

  await expect.poll(() => cardOrder(page, idA, idB), { timeout: 10_000 }).toBe("B-first");
  const moveRes = await moveDone;
  expect(moveRes.ok()).toBe(true);

  // Order persists across a reload (POST /v1/games/:id/move round-trip).
  await page.reload();
  await expect(page.getByTestId("games-home")).toBeVisible();
  await expect(cardBody(page, hostA)).toBeVisible();
  expect(await cardOrder(page, idA, idB)).toBe("B-first");

  // Tap through to the per-game board: day rail + my posted result.
  await cardBody(page, hostA).click();
  await expect(page.getByTestId("game-board")).toBeVisible();
  await expect(page.locator('[data-testid^="game-board-day-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="game-board-score-"]').first()).toContainText(
    "Score: 42",
  );

  // Back to the home — cards still there.
  await page.getByTestId("game-board-back").click();
  await expect(page.getByTestId("games-home")).toBeVisible();
});

/** The card body (title block) for the card titled `host`. */
function cardBody(page: Page, host: string) {
  return page.locator('[data-testid^="game-card-body-"]', { hasText: host });
}

async function cardIdFor(page: Page, host: string): Promise<string> {
  const id = await cardBody(page, host).getAttribute("data-testid");
  if (!id) throw new Error(`no game card titled ${host}`);
  return id.replace("game-card-body-", "");
}

/** Relative order of this run's two cards among however many exist. */
async function cardOrder(page: Page, idA: string, idB: string): Promise<string> {
  const ids = await page
    .locator('[data-testid^="game-card-body-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  const a = ids.indexOf(`game-card-body-${idA}`);
  const b = ids.indexOf(`game-card-body-${idB}`);
  if (a < 0 || b < 0) return "missing";
  return a < b ? "A-first" : "B-first";
}
