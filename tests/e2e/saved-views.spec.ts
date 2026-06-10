import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn, signInAsDev } from "./helpers";

// L2 — saved views. Acceptance flow from the issue: tag an item, filter to it,
// save the filter as a named view, reload, and confirm the view persists as a
// one-tap chip that re-applies the filter. Also exercises delete.
//
// Reuses the dev sign-in backdoor seeded by `scripts/e2e.sh`. Unique list name
// per run so a dirty dev DB doesn't conflict. Builds on the same item + tag
// machinery proven in tags-filter.spec.ts.

test("save filter as a view → reload → apply → delete", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  await signInAsDev(page, { displayName: "E2E Viewer" });

  // Create a date-ideas list.
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-template-date_ideas").click();
  const listName = `E2E views ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Add two items so a saved view has something to narrow to.
  await expect(page.getByTestId("list-detail-empty-add")).toBeVisible();
  await page.getByTestId("list-detail-empty-add").click();
  await page.getByTestId("add-item-title").fill("Burger crawl downtown");
  await page.getByTestId("add-item-submit").click();
  await expect(page.locator('[data-testid^="item-row-"]').first()).toBeVisible();

  await page.getByTestId("fab-add-item").click();
  await page.getByTestId("add-item-title").fill("Museum afternoon");
  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("list-detail-list").getByText("Museum afternoon")).toBeVisible();

  // Tag the burger item.
  await page.getByText("Burger crawl downtown").click();
  await expect(page.getByTestId("item-tag-input")).toBeVisible();
  await page.getByTestId("item-tag-input").fill("Burgers");
  await page.getByTestId("item-tag-input").press("Enter");
  await expect(page.getByTestId("item-tag-burgers")).toBeVisible();
  await page.getByTestId("item-back-to-list").click();

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
  await page.reload();
  await expect(page.getByTestId("saved-view-burgers")).toBeVisible();
  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // Tapping the view re-applies its filter — rows narrow to the tagged item.
  await page.getByTestId("saved-view-burgers").click();
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toHaveCount(0);

  // With the view active, the contextual Delete chip removes it (confirm
  // dialog auto-accepted). The chip disappears for everyone.
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByTestId("saved-view-delete").click();
  await expect(page.getByTestId("saved-view-burgers")).toHaveCount(0);
});
