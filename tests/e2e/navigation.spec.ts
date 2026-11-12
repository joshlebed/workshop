import {
  api,
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
  toast,
} from "./helpers";

// UX pass phase 3 journeys (docs/ux-pass-plan.md §5): "share a list" in two
// taps and hide a list with Undo, plus the 3.8 back fallback for a cold-opened
// modal and the branded not-found page. A scratch user owns a
// `zz-ux-scratch-e2e-*` list made through the API; cleanup deletes it.

let user: ScratchUser | null = null;
let listId = "";
let listName = "";

test.beforeAll(async () => {
  user = await mintScratchUser("nav");
  const list = await createScratchList(user, { name: "nav", emoji: "🧭", color: "ocean" });
  listId = list.id;
  listName = list.name;
});

test.afterAll(async () => cleanupScratchUser(user));

test.beforeEach(async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
});

test.use({ viewport: { width: 390, height: 844 } });

async function shareVisibility(): Promise<string> {
  if (!user) throw new Error("no scratch user");
  const res = await api<{ list: { shareVisibility: string } }>(user, "GET", `/v1/lists/${listId}`);
  return res.list.shareVisibility;
}

test("share a list: two taps from the list", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/list/${listId}`);

  // Tap 1: the share button in the header. Tap 2: Share link.
  await page.getByTestId("list-detail-share").click();
  await expect(page.getByTestId("share-sheet")).toBeVisible();
  await page.getByTestId("share-sheet-share").click();
  // Headless Chromium has no Web Share, so the link is copied.
  await expect(toast(page, /copied/i)).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/l\/[A-Za-z0-9]+$/);

  // Owners pick who the link lets in; the choice saves on tap.
  await page.getByTestId("list-detail-share").click();
  await page.getByTestId("share-visibility-view").click();
  await expect.poll(shareVisibility).toBe("view");
  await page.getByTestId("share-visibility-join").click();
  await expect.poll(shareVisibility).toBe("join");
});

test("hide a list from the home row menu, then undo", async ({ page }) => {
  await page.goto("/");
  const row = page.getByTestId(`list-card-${listId}`);
  await expect(row).toBeVisible();

  // The row menu opens from right-click (and long-press / the hover "more").
  await row.click({ button: "right" });
  await page.getByTestId("row-menu-hide").click();
  await expect(toast(page, listName)).toBeVisible();
  await expect(row).toHaveCount(0);

  await toast(page, listName).getByTestId("toast-action").click();
  await expect(row).toBeVisible();
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByTestId(`list-card-${listId}`)).toBeVisible();
});

test("a modal opened cold goes back to its list, not home", async ({ page }) => {
  await page.goto(`/list/${listId}/add`);
  await page.getByTestId("add-item-cancel").click();
  await expect(page).toHaveURL(new RegExp(`/list/${listId}$`));
  await page.getByTestId("list-detail-back").click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test("unknown routes show the branded not-found page", async ({ page }) => {
  await page.goto("/friends");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.getByTestId("not-found-home").click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});
