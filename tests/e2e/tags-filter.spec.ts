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

// L1 — tags + filter chips: tag an item on its detail screen, the chip bar
// shows the tag with its count, tapping the chip narrows the rows, "All"
// clears, a second tag makes multi-select an AND. Runs at the default desktop
// viewport, so the list sits in the two-pane layout's right pane.
//
// A scratch user owns a `zz-ux-scratch-e2e-*` link list with two items made
// through the API; cleanup deletes it.

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("tags");
  listId = (
    await createScratchList(user, {
      name: "tags",
      emoji: "💜",
      color: "rose",
      itemKind: "link",
      modules: ["todo", "ranking"],
    })
  ).id;
  await addScratchItem(user, listId, { title: "Burger crawl downtown" });
  await addScratchItem(user, listId, { title: "Museum afternoon" });
});

test.afterAll(async () => cleanupScratchUser(user));

test("add tag → chip appears → filter narrows rows → All clears", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto(`/list/${listId}`);

  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // No tags yet → no chip bar.
  await expect(page.getByTestId("tag-filter-bar")).toHaveCount(0);

  // Open the burger item and tag it via the editor's free-text input.
  await list.getByText("Burger crawl downtown").click();
  await expect(page.getByTestId("item-tag-input")).toBeVisible();
  await page.getByTestId("item-tag-input").fill("Burgers");
  await page.getByTestId("item-tag-input").press("Enter");
  // Server normalizes to lowercase; the chip renders selected.
  await expect(page.getByTestId("item-tag-burgers")).toBeVisible();

  // Back to the list — the chip bar shows the tag with its count.
  await page.getByTestId("item-back-to-list").click();
  await expect(page.getByTestId("tag-filter-bar")).toBeVisible();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("burgers");
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("1");

  // Tap the chip → rows narrow to the tagged item.
  await page.getByTestId("tag-filter-burgers").click();
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toHaveCount(0);

  // "All" clears the filter.
  await page.getByTestId("tag-filter-all").click();
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // Suggested-chip picker: the second item offers the list's existing tag.
  await list.getByText("Museum afternoon").click();
  await expect(page.getByTestId("item-tag-suggest-burgers")).toBeVisible();
  await page.getByTestId("item-tag-suggest-burgers").click();
  await expect(page.getByTestId("item-tag-burgers")).toBeVisible();
  // Second tag on the museum item only, so multi-select has a real intersection.
  await page.getByTestId("item-tag-input").fill("Indoor");
  await page.getByTestId("item-tag-input").press("Enter");
  await expect(page.getByTestId("item-tag-indoor")).toBeVisible();
  await page.getByTestId("item-back-to-list").click();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("2");

  // Multi-select is AND: burgers alone shows both, burgers + indoor narrows
  // to the item carrying every selected tag.
  await page.getByTestId("tag-filter-burgers").click();
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toBeVisible();
  await page.getByTestId("tag-filter-indoor").click();
  await expect(list.getByText("Museum afternoon")).toBeVisible();
  await expect(list.getByText("Burger crawl downtown")).toHaveCount(0);
});
