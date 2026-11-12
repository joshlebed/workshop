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

// L2 — saved views: filter to a tag, save the filter as a named view, reload,
// and confirm the view persists as a one-tap chip that re-applies the filter.
// Also exercises delete. The tagging itself is covered by tags-filter.spec.ts,
// so the items arrive tagged through the API.
//
// A scratch user owns a `zz-ux-scratch-e2e-*` link list; cleanup deletes it.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("views");
  listId = (
    await createScratchList(user, {
      name: "views",
      emoji: "💜",
      color: "rose",
      itemKind: "link",
      modules: ["todo", "ranking"],
    })
  ).id;
  await addScratchItem(user, listId, { title: "Burger crawl downtown", tags: ["burgers"] });
  await addScratchItem(user, listId, { title: "Museum afternoon" });
});

test.afterAll(async () => cleanupScratchUser(user));

test("save filter as a view → reload → apply → delete", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto(`/list/${listId}`);
  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // No saved views yet, and no filter active → no saved-views bar.
  await expect(page.getByTestId("saved-views-bar")).toHaveCount(0);

  // Apply the burgers tag filter — now the "Save view" affordance appears.
  await page.getByTestId("tag-filter-burgers").click();
  await expect(page.getByTestId("saved-view-save")).toBeVisible();

  // Save the current filter as a named view.
  await page.getByTestId("saved-view-save").click();
  await expect(page.getByTestId("saved-view-name-input")).toBeVisible();
  await page.getByTestId("saved-view-name-input").fill("Burgers");
  await page.getByTestId("saved-view-save-submit").click();

  // The view appears as a one-tap chip; the current filter is now "saved" so
  // the Save affordance flips to a Delete one.
  await expect(page.getByTestId("saved-view-burgers")).toBeVisible();
  await expect(page.getByTestId("saved-view-save")).toHaveCount(0);

  // Reload: the saved view survives (shared, server-stored), but the live
  // filter resets — exactly the "reopening applies the filter" contract.
  // Wait for the query-cache persister (1s throttle) to write the new view:
  // a reload before that restores the pre-save views, fresh for 30s, and the
  // chip stays hidden until they go stale.
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("workshop.query-cache.v1")?.includes('"name":"Burgers"'),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByTestId("saved-view-burgers")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // Tapping the view re-applies its filter — rows narrow to the tagged item.
  await page.getByTestId("saved-view-burgers").click();
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toHaveCount(0);

  // With the view active, the contextual Delete chip removes it (the confirm
  // is the in-app dialog on web, or `window.confirm`).
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByTestId("saved-view-delete").click();
  const confirm = page.getByTestId("confirm-dialog-confirm");
  if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
  await expect(page.getByTestId("saved-view-burgers")).toHaveCount(0);
});
