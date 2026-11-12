import {
  cleanupScratchUser,
  createScratchList,
  expect,
  ITEM_ROWS,
  itemRow,
  mintScratchUser,
  type ScratchUser,
  scratchListName,
  seedSession,
  test,
} from "./helpers";

// Create a list the long way (FAB → template picker with "Customize first" →
// name it → Create), add two items, move one to the top from the row menu,
// complete it from the row menu. The one-tap create path is first-run.spec.ts;
// the checkbox and Undo paths are list-loop.spec.ts. This one keeps the
// Customize form, the one order and the menu's complete covered.
//
// A scratch user (with one API-made list, so home shows the FAB) owns
// everything; cleanup deletes every list it owns.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;

test.beforeAll(async () => {
  user = await mintScratchUser("flow");
  await createScratchList(user, { name: "flow-existing" });
});

test.afterAll(async () => cleanupScratchUser(user));

test("create list → add items → move to top → complete", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto("/");

  // FAB → picker; Customize first → Date ideas → name it → Create.
  await page.getByTestId("fab-create-list").click();
  await page.waitForURL(/\/create-list\/type/);
  await page.getByTestId("create-list-customize-first").click();
  await page.getByTestId("create-list-template-date_ideas").click();
  await page.waitForURL(/\/create-list\/customize/);
  const listName = scratchListName("flow");
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Lands in the new list with the add surface open (4.3).
  await page.waitForURL(/\/list\/[^/]+\/add/);
  const itemTitle = `Picnic at the park ${Date.now()}`;
  await page.getByTestId("add-item-title").fill(itemTitle);
  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("add-item-added")).toContainText(itemTitle);
  // A second row, so there is something to move past.
  await page.getByTestId("add-item-title").fill("Museum afternoon");
  await page.getByTestId("add-item-title").press("Enter");
  await expect(page.getByTestId("add-item-added")).toContainText("Museum afternoon");
  // Quick add stays open for the next item (2.4); close it to see the list.
  await page.getByTestId("add-item-cancel").click();
  await page.waitForURL(/\/list\/[^/]+$/);
  await expect(page.getByTestId("list-detail-name")).toHaveText(listName);

  // Both items land at the top as they are added (newest first), in one list
  // with no section headings and no numbers.
  const row = itemRow(page, itemTitle);
  await expect(page.locator(ITEM_ROWS)).toHaveCount(2);
  await expect(page.locator(ITEM_ROWS).first()).toContainText("Museum afternoon");
  await expect(page.locator('[data-testid^="list-detail-section-"]')).toHaveCount(0);

  // Row menu → Move to top; there is no Ranked section, and no rank words.
  await row.locator('[data-testid^="item-row-menu-"]').click();
  await expect(page.getByTestId("item-row-menu-sheet")).not.toContainText(/rank/i);
  await page.getByTestId("item-row-menu-top").click();
  await expect(page.locator(ITEM_ROWS).first()).toContainText(itemTitle);
  await expect(page.locator('[data-testid^="list-detail-section-"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator(ITEM_ROWS).first()).toContainText(itemTitle);

  // Row menu → mark done. The Done section appears.
  await row.locator('[data-testid^="item-row-menu-"]').click();
  await page.getByTestId("item-row-menu-complete").click();
  await expect(page.getByTestId("list-detail-section-completed")).toBeVisible();
});
