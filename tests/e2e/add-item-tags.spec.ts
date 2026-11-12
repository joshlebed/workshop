import {
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// Tagging happens on the add-item form, not only after the fact on the item
// detail screen: the tags ride along on `POST /v1/lists/:id/items`, so an item
// lands already filed. Type a new tag while adding, then tap the same tag as a
// suggestion on the next add.
//
// A scratch user owns a `zz-ux-scratch-e2e-*` link list; cleanup deletes it.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("add-tags");
  listId = (
    await createScratchList(user, {
      name: "add-tags",
      emoji: "💜",
      color: "rose",
      itemKind: "link",
      modules: ["todo", "ranking"],
    })
  ).id;
});

test.afterAll(async () => cleanupScratchUser(user));

test("tag an item while adding it → chip bar counts it → suggested on the next add", async ({
  page,
}) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto(`/list/${listId}`);

  // First add: brand-new tag typed into the picker's inline input. The list
  // has no tags yet, so there's nothing to suggest.
  await page.getByTestId("list-detail-empty-add").click();
  await page.getByTestId("add-item-title").fill("Burger crawl downtown");
  // Tags live behind "Details" in quick add (2.4).
  await page.getByTestId("add-item-details-toggle").click();
  await expect(page.getByTestId("add-item-tag-input")).toBeVisible();
  await page.getByTestId("add-item-tag-input").fill("Burgers");
  await page.getByTestId("add-item-tag-input").press("Enter");
  // Normalized to lowercase client-side; the chip renders selected.
  await expect(page.getByTestId("add-item-tag-burgers")).toBeVisible();
  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("add-item-added")).toContainText("Burger crawl downtown");
  await page.getByTestId("add-item-cancel").click();

  // The tag landed with the item — the filter bar counts it without any
  // trip through the item detail screen.
  await expect(page.getByTestId("tag-filter-bar")).toBeVisible();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("1");

  // Second add: the list's tag is now one tap away as a suggestion.
  await page.getByTestId("fab-add-item").click();
  await page.getByTestId("add-item-title").fill("Smash burger night");
  await page.getByTestId("add-item-details-toggle").click();
  await expect(page.getByTestId("add-item-tag-suggest-burgers")).toBeVisible();
  await page.getByTestId("add-item-tag-suggest-burgers").click();
  await expect(page.getByTestId("add-item-tag-burgers")).toBeVisible();
  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("add-item-added")).toContainText("Smash burger night");
  await page.getByTestId("add-item-cancel").click();

  await expect(page.getByTestId("tag-filter-burgers")).toContainText("2");

  // Filtering by the tag keeps both items — proof they're really tagged.
  await page.getByTestId("tag-filter-burgers").click();
  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Smash burger night")).toBeVisible();
});
