import {
  cleanupScratchUser,
  createScratchList,
  expect,
  itemRow,
  itemTitles,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
  toast,
} from "./helpers";

// UX pass phase 2 journeys (docs/ux-pass-plan.md §5): "add five plain items"
// in two taps + five Returns, "complete an item" with one tap, and "undo a
// mistake" (complete + undo, delete + undo), plus reorder from the row menu.
// A scratch user owns a `zz-ux-scratch-e2e-*` list made through the API;
// cleanup deletes it.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("loop");
  listId = (await createScratchList(user, { name: "loop", emoji: "✅", color: "forest" })).id;
});

test.afterAll(async () => cleanupScratchUser(user));

test("add five by keyboard, complete + undo, delete + undo, move up", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto(`/list/${listId}`);

  // Two taps (open add, close) and five Returns.
  await page.getByTestId("list-detail-empty-add").click();
  const field = page.getByTestId("add-item-title");
  await expect(field).toBeFocused();
  for (const n of ["One", "Two", "Three", "Four", "Five"]) {
    await page.keyboard.type(`Item ${n}`);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("add-item-added")).toContainText(`Item ${n}`);
    await expect(field).toHaveValue("");
  }
  await page.getByTestId("add-item-cancel").click();
  await expect
    .poll(() => itemTitles(page))
    .toEqual(["Item Five", "Item Four", "Item Three", "Item Two", "Item One"]);

  // One tap completes; Undo puts it back where it was.
  await itemRow(page, "Item Three").locator('[data-testid^="item-row-check-"]').click();
  await expect(toast(page, /Marked/)).toBeVisible();
  await expect(page.getByTestId("list-detail-subline")).toContainText("4 to do");
  await toast(page, /Marked/)
    .getByTestId("toast-action")
    .click();
  await expect(page.getByTestId("list-detail-subline")).toContainText("5 to do");

  // Delete has no confirm; Undo restores it.
  await itemRow(page, "Item Two").locator('[data-testid^="item-row-menu-"]').first().click();
  await page.getByTestId("item-row-menu-delete").click();
  await expect(toast(page, "Item Two")).toBeVisible();
  await expect(itemRow(page, "Item Two")).toHaveCount(0);
  await toast(page, "Item Two").getByTestId("toast-action").click();
  await expect(itemRow(page, "Item Two")).toHaveCount(1);

  // Keyboard path for reorder.
  await itemRow(page, "Item One").locator('[data-testid^="item-row-menu-"]').first().click();
  await page.getByTestId("item-row-menu-up").click();

  await page.waitForTimeout(1500);
  await page.reload();
  await expect
    .poll(() => itemTitles(page))
    .toEqual(["Item Five", "Item Four", "Item Three", "Item One", "Item Two"]);

  // A new item lands on top and the hand-placed order below it holds.
  await page.getByTestId("fab-add-item").click();
  await page.getByTestId("add-item-title").fill("Item Six");
  await page.getByTestId("add-item-title").press("Enter");
  await expect(page.getByTestId("add-item-added")).toContainText("Item Six");
  await page.getByTestId("add-item-cancel").click();
  await expect
    .poll(() => itemTitles(page))
    .toEqual(["Item Six", "Item Five", "Item Four", "Item Three", "Item One", "Item Two"]);

  // Move to top, then Undo puts it back where it was.
  await itemRow(page, "Item Two").locator('[data-testid^="item-row-menu-"]').first().click();
  await page.getByTestId("item-row-menu-top").click();
  await expect.poll(async () => (await itemTitles(page))[0]).toBe("Item Two");
  await toast(page, "Moved to top").getByTestId("toast-action").click();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect
    .poll(() => itemTitles(page))
    .toEqual(["Item Six", "Item Five", "Item Four", "Item Three", "Item One", "Item Two"]);
});
