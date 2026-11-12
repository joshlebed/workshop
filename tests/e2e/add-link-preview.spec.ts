import {
  cleanupScratchUser,
  createScratchList,
  expect,
  ITEM_ROWS,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// Link lists: type a title, paste a URL under "Details", see the inline link
// preview, save. Runs at the default desktop viewport (two-pane right pane).
//
// `/v1/link-preview` is mocked so the spec doesn't depend on a live fetcher
// (covered by apps/backend/src/routes/v1/link-preview.test.ts). A scratch user
// owns a `zz-ux-scratch-e2e-*` link list; cleanup deletes it.

const PREVIEW_FIXTURE = {
  preview: {
    url: "https://example.com/picnic",
    finalUrl: "https://example.com/picnic",
    title: "Picnic in the park",
    description: "An afternoon picnic spot under the oak.",
    image: "https://example.com/picnic.jpg",
    siteName: "Example",
    fetchedAt: new Date().toISOString(),
  },
};

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("preview");
  listId = (
    await createScratchList(user, {
      name: "preview",
      emoji: "💜",
      color: "rose",
      itemKind: "link",
      modules: ["todo", "ranking"],
    })
  ).id;
});

test.afterAll(async () => cleanupScratchUser(user));

test("link list → paste URL → see preview → save", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.route("**/v1/link-preview**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PREVIEW_FIXTURE),
    });
  });

  await page.goto(`/list/${listId}`);
  await page.getByTestId("list-detail-empty-add").click();

  // Free-form fields (link list → free-form, not search).
  const titleInput = page.getByTestId("add-item-title");
  await page.getByTestId("add-item-details-toggle").click();
  const urlInput = page.getByTestId("add-item-url");
  await expect(titleInput).toBeVisible();
  await expect(urlInput).toBeVisible();

  await titleInput.fill("Picnic at the park");
  await urlInput.fill("https://example.com/picnic");

  // Inline preview card appears after the debounce → mocked fetch.
  await expect(page.getByTestId("link-preview-card")).toBeVisible();
  await expect(page.getByTestId("link-preview-title")).toContainText("Picnic in the park");

  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("add-item-added")).toContainText("Picnic at the park");
  await page.getByTestId("add-item-cancel").click();

  // Back on list detail; the new item is on the list.
  const row = page.locator(ITEM_ROWS).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Picnic at the park");
});
