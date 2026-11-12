import {
  addScratchItem,
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// UX pass 5 review: on a phone, list detail pins only a compact bar (back,
// the list name once the big title has scrolled away, share, settings). The
// title block, search field and tag bar scroll with the rows; while they're
// out of view the bar offers search (and shows an active filter), and `/`
// brings the field back.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("chrome");
  listId = (await createScratchList(user, { name: "chrome", emoji: "🧪", color: "ocean" })).id;
  for (let i = 1; i <= 20; i++) {
    await addScratchItem(user, listId, { title: `Row ${i}`, tags: [i % 2 ? "odd" : "even"] });
  }
});

test.afterAll(async () => cleanupScratchUser(user));

test.beforeEach(async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
});

const scroller = (page: import("@playwright/test").Page) =>
  page.evaluateHandle(() => {
    let el = document.querySelector<HTMLElement>('[data-testid="list-detail-list"]');
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    return el;
  });

test("only a compact bar stays pinned; search comes back from it", async ({ page }) => {
  await page.goto(`/list/${listId}`);
  const firstRow = page.locator('[data-testid^="item-row-body-"]').first();
  await expect(firstRow).toBeVisible();
  // Content starts within the top third of the screen.
  expect((await firstRow.boundingBox())?.y ?? 999).toBeLessThan(300);
  const barTitle = page.getByTestId("list-detail-bar-title");
  await expect(barTitle).toHaveCSS("opacity", "0");

  // Scroll the header away: the list name fades into the bar, search moves there.
  const el = await scroller(page);
  await el.evaluate((node) => {
    if (node) (node as HTMLElement).scrollTop = 600;
  });
  await expect(barTitle).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("list-detail-bar-search")).toBeVisible();

  // `/` jumps back to the field and focuses it.
  await page.keyboard.press("/");
  await expect(page.getByTestId("list-detail-filter")).toBeFocused();
  await expect(page.getByTestId("list-detail-bar-search")).toHaveCount(0);

  // An active filter stays visible (and clearable) from the bar once scrolled away.
  await page.keyboard.type("Row");
  await page.getByTestId("list-detail-filter").blur();
  await el.evaluate((node) => {
    if (node) (node as HTMLElement).scrollTop = 600;
  });
  const chip = page.getByTestId("list-detail-bar-filter");
  await expect(chip).toContainText("Row");
  await page.getByTestId("list-detail-bar-filter-clear").click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByTestId("list-detail-filter")).toHaveValue("");
});
