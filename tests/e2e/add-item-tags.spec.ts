import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn, signInAsDev } from "./helpers";

// Tagging happens on the add-item form, not only after the fact on the item
// detail screen: the tags ride along on `POST /v1/lists/:id/items`, so an item
// lands already filed. This walks the acceptance flow — type a new tag while
// adding, then tap the same tag as a suggestion on the next add.
//
// Reuses the dev sign-in backdoor seeded by `scripts/e2e.sh`. Unique list
// name per run so a dirty dev DB doesn't conflict.

test("tag an item while adding it → chip bar counts it → suggested on the next add", async ({
  page,
}) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  await signInAsDev(page, { displayName: "E2E Add Tagger" });

  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-template-date_ideas").click();
  const listName = `E2E add tags ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // First add: brand-new tag typed into the picker's inline input. The list
  // has no tags yet, so there's nothing to suggest.
  await expect(page.getByTestId("list-detail-empty-add")).toBeVisible();
  await page.getByTestId("list-detail-empty-add").click();
  await page.getByTestId("add-item-title").fill("Burger crawl downtown");
  await expect(page.getByTestId("add-item-tag-input")).toBeVisible();
  await page.getByTestId("add-item-tag-input").fill("Burgers");
  await page.getByTestId("add-item-tag-input").press("Enter");
  // Normalized to lowercase client-side; the chip renders selected.
  await expect(page.getByTestId("add-item-tag-burgers")).toBeVisible();
  await page.getByTestId("add-item-submit").click();

  // The tag landed with the item — the filter bar counts it without any
  // trip through the item detail screen.
  await expect(page.getByTestId("tag-filter-bar")).toBeVisible();
  await expect(page.getByTestId("tag-filter-burgers")).toContainText("burgers (1)");

  // Second add: the list's tag is now one tap away as a suggestion.
  await page.getByTestId("fab-add-item").click();
  await page.getByTestId("add-item-title").fill("Smash burger night");
  await expect(page.getByTestId("add-item-tag-suggest-burgers")).toBeVisible();
  await page.getByTestId("add-item-tag-suggest-burgers").click();
  await expect(page.getByTestId("add-item-tag-burgers")).toBeVisible();
  await page.getByTestId("add-item-submit").click();

  await expect(page.getByTestId("tag-filter-burgers")).toContainText("burgers (2)");

  // Filtering by the tag keeps both items — proof they're really tagged.
  await page.getByTestId("tag-filter-burgers").click();
  const list = page.getByTestId("list-detail-list");
  await expect(list.getByText("Burger crawl downtown")).toBeVisible();
  await expect(list.getByText("Smash burger night")).toBeVisible();
});
