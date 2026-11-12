import {
  addScratchItem,
  cleanupScratchUser,
  createScratchList,
  expect,
  itemRow,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
  toast,
} from "./helpers";

// UX pass 5.7 (desktop web): the two-pane layout (lists sidebar beside the
// open list) at ≥900px, keyboard shortcuts, and the toast navigation rule
// (a toast belongs to the screen that raised it). Viewport 1440×900, except
// the checks that the phone layout has no sidebar.
//
// A scratch user owns two `zz-ux-scratch-e2e-*` lists made through the API
// (the sidebar only shows for someone with lists); cleanup deletes them.

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test.use({ viewport: DESKTOP });

let user: ScratchUser | null = null;
let listA = "";
let listB = "";

test.beforeAll(async () => {
  user = await mintScratchUser("desktop");
  listA = (await createScratchList(user, { name: "desktop-a", emoji: "🅰️", color: "ocean" })).id;
  listB = (await createScratchList(user, { name: "desktop-b", emoji: "🅱️", color: "forest" })).id;
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await addScratchItem(user, listA, { title });
  }
});

test.afterAll(async () => cleanupScratchUser(user));

test.beforeEach(async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
});

const listPath = (id: string) => new RegExp(`/list/${id}$`);

test.describe("two-pane layout", () => {
  test("sidebar beside the pane; rows open lists; history and reload keep the open list", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Lists" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-testid", "lists-sidebar");
    // No list open: the pane says what to do next.
    await expect(page.getByTestId("home-pane-placeholder")).toBeVisible();

    // The sidebar is left of the pane, side by side.
    const sideBox = await sidebar.boundingBox();
    const paneBox = await page.getByTestId("home-pane-placeholder").boundingBox();
    expect(sideBox && paneBox && sideBox.x + sideBox.width <= paneBox.x + 1).toBe(true);

    // Click a row: the list opens in the pane and the row is the current page.
    const rowA = sidebar.getByTestId(`list-card-${listA}`);
    const rowB = sidebar.getByTestId(`list-card-${listB}`);
    await rowA.click();
    await expect(page).toHaveURL(listPath(listA));
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-a");
    await expect(page.getByTestId("home-pane-placeholder")).toBeHidden();
    await expect(sidebar).toBeVisible();
    await expect(rowA).toHaveAttribute("aria-current", "page");
    await expect(rowB).not.toHaveAttribute("aria-current", "page");
    // The sidebar is the way between lists, so the list has no back button.
    await expect(page.getByTestId("list-detail-back")).toHaveCount(0);

    await rowB.click();
    await expect(page).toHaveURL(listPath(listB));
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-b");
    await expect(rowB).toHaveAttribute("aria-current", "page");
    await expect(rowA).not.toHaveAttribute("aria-current", "page");

    // Browser back and forward keep the pane in step with the URL. Opening a
    // list from the sidebar replaces the open one (home stays beneath, the
    // stack stays shallow), so back from B is home's placeholder, and forward
    // is B again.
    await page.goBack();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByTestId("home-pane-placeholder")).toBeVisible();
    await expect(rowA).not.toHaveAttribute("aria-current", "page");
    await expect(rowB).not.toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(listPath(listB));
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-b");
    await expect(rowB).toHaveAttribute("aria-current", "page");

    // Reload keeps the open list and the sidebar.
    await page.reload();
    await expect(page).toHaveURL(listPath(listB));
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-b");
    await expect(page.getByTestId("lists-sidebar")).toBeVisible();
    await expect(
      page.getByTestId("lists-sidebar").getByTestId(`list-card-${listB}`),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a deep link to a list loads with the sidebar", async ({ page }) => {
    await page.goto(`/list/${listA}`);
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-a");
    const sidebar = page.getByTestId("lists-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId(`list-card-${listA}`)).toHaveAttribute("aria-current", "page");

    // Inside the pane, history is the stack's: an item, then back to the list.
    await itemRow(page, "Alpha").locator('[data-testid^="item-row-body-"]').first().click();
    await expect(page.getByTestId("item-title-input")).toHaveValue("Alpha");
    await expect(sidebar.getByTestId(`list-card-${listA}`)).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(listPath(listA));
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-a");
  });

  test("phone width has no sidebar", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(page.getByTestId(`list-card-${listA}`)).toBeVisible();
    await expect(page.getByTestId("lists-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("home-pane-placeholder")).toHaveCount(0);
    await page.goto(`/list/${listA}`);
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-a");
    await expect(page.getByTestId("lists-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("list-detail-back")).toBeVisible();
  });
});

test.describe("keyboard shortcuts", () => {
  test("? opens the shortcuts sheet and Escape closes it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("lists-sidebar")).toBeVisible();
    await page.locator("body").click({ position: { x: 700, y: 880 } });
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-sheet")).toBeHidden();
  });

  test("on a list, n opens add and Escape returns; / focuses search, where n is just a letter", async ({
    page,
  }) => {
    await page.goto(`/list/${listA}`);
    await expect(page.getByTestId("list-detail-name")).toContainText("desktop-a");
    await expect(itemRow(page, "Alpha")).toBeVisible();

    await page.keyboard.press("n");
    await expect(page).toHaveURL(new RegExp(`/list/${listA}/add$`));
    await expect(page.getByTestId("add-item-title")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(listPath(listA));
    await expect(page.getByTestId("add-item-title")).toHaveCount(0);

    const filter = page.getByTestId("list-detail-filter");
    await page.keyboard.press("/");
    await expect(filter).toBeFocused();
    await page.keyboard.type("n");
    await expect(filter).toHaveValue("n");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(listPath(listA));
  });

  test("on home at phone width, n opens the new-list picker", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(page.getByTestId("fab-create-list")).toBeVisible();
    await page.keyboard.press("n");
    await expect(page).toHaveURL(/\/create-list\/type$/);
  });
});

test.describe("toast navigation rule", () => {
  test("opening add dismisses the delete toast; deleting from item detail keeps it, and Undo restores", async ({
    page,
  }) => {
    await page.goto(`/list/${listA}`);
    await expect(itemRow(page, "Charlie")).toBeVisible();

    // Row menu → Delete: an Undo toast.
    await itemRow(page, "Charlie").locator('[data-testid^="item-row-menu-"]').first().click();
    await page.getByTestId("item-row-menu-delete").click();
    await expect(itemRow(page, "Charlie")).toHaveCount(0);
    await expect(toast(page, "Charlie")).toBeVisible();
    await expect(toast(page, "Charlie").getByTestId("toast-action")).toBeVisible();

    // Opening a new screen (the add surface) dismisses it.
    await page.getByTestId("fab-add-item").click();
    await expect(page).toHaveURL(new RegExp(`/list/${listA}/add$`));
    await expect(toast(page, "Charlie")).toBeHidden();
    await page.getByTestId("add-item-cancel").click();
    await expect(page).toHaveURL(listPath(listA));

    // Delete from item detail: back on the list, the toast is still there.
    await itemRow(page, "Bravo").locator('[data-testid^="item-row-body-"]').first().click();
    await expect(page.getByTestId("item-title-input")).toHaveValue("Bravo");
    await page.getByTestId("item-more").click();
    await page.getByTestId("item-menu-delete").click();
    await expect(page).toHaveURL(listPath(listA));
    await expect(toast(page, "Bravo")).toBeVisible();
    await expect(itemRow(page, "Bravo")).toHaveCount(0);

    await toast(page, "Bravo").getByTestId("toast-action").click();
    await expect(itemRow(page, "Bravo")).toBeVisible();
  });
});
