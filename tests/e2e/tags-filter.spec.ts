import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn, signInAsDev } from "./helpers";

// L1 — tags + filter chips. Acceptance flow from the issue: tag a
// Date-Ideas item, the chip bar shows the tag with its count, tapping the
// chip narrows the rows instantly, "All" clears the filter.
//
// Reuses the dev sign-in backdoor seeded by `scripts/e2e.sh`. Unique list
// name per run so a dirty dev DB doesn't conflict.

test("add tag → chip appears → filter narrows rows → All clears", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  await signInAsDev(page, { displayName: "E2E Tagger" });

  // Create a date-ideas list.
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-template-date_ideas").click();
  const listName = `E2E tags ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Add two items so the filter has something to narrow.
  await expect(page.getByTestId("list-detail-empty-add")).toBeVisible();
  await page.getByTestId("list-detail-empty-add").click();
  await page.getByTestId("add-item-title").fill("Burger crawl downtown");
  await page.getByTestId("add-item-submit").click();
  await expect(page.locator('[data-testid^="item-row-"]').first()).toBeVisible();

  await page.getByTestId("fab-add-item").click();
  await page.getByTestId("add-item-title").fill("Museum afternoon");
  await page.getByTestId("add-item-submit").click();
  await expect(page.getByTestId("list-detail-list").getByText("Museum afternoon")).toBeVisible();

  // No tags yet → no chip bar.
  await expect(page.getByTestId("tag-filter-bar")).toHaveCount(0);

  // Open the burger item and tag it via the editor's free-text input.
  await page.getByText("Burger crawl downtown").click();
  await expect(page.getByTestId("item-tag-input")).toBeVisible();
  await page.getByTestId("item-tag-input").fill("Burgers");
  await page.getByTestId("item-tag-input").press("Enter");
  // Server normalizes to lowercase; the chip renders selected.
  await expect(page.getByTestId("item-tag-burgers")).toBeVisible();

  // Back to the list — the chip bar shows the tag with its count.
  await page.getByTestId("item-back-to-list").click();
  await expect(page.getByTestId("tag-filter-bar")).toBeVisible();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("burgers (1)");

  // Tap the chip → rows narrow to the tagged item.
  await page.getByTestId("tag-filter-burgers").click();
  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Museum afternoon")).toHaveCount(0);

  // "All" clears the filter.
  await page.getByTestId("tag-filter-all").click();
  await expect(list.getByText("Museum afternoon")).toBeVisible();

  // Suggested-chip picker: the second item offers the list's existing tag.
  await page.getByText("Museum afternoon").click();
  await expect(page.getByTestId("item-tag-suggest-burgers")).toBeVisible();
  await page.getByTestId("item-tag-suggest-burgers").click();
  await expect(page.getByTestId("item-tag-burgers")).toBeVisible();
  await page.getByTestId("item-back-to-list").click();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("burgers (2)");
});
