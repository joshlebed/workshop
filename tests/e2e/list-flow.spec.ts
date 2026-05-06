import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path for chunk 1b-2: dev-sign-in → create list → add item →
// rank/unrank via kebab → complete. Updated for the 2026-05 ordering
// refactor: every list type now has ordered / unordered / completed
// sections with drag-to-reorder and a kebab menu (no upvote pill).
//
// Reuses the dev sign-in backdoor seeded by `scripts/e2e.sh` (DEV_AUTH_ENABLED=1).
// Each run uses a unique list name so re-running against a dirty dev DB doesn't
// conflict with prior runs.

test("create list → add item → rank → complete", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  // Sign in via the dev backdoor + onboard if needed.
  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  if (
    await page
      .getByTestId("display-name-input")
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByTestId("display-name-input").fill("E2E Tester");
    await page.getByTestId("display-name-save").click();
  }

  await expect(page.getByTestId("home-greeting")).toBeVisible();

  // Open the create-list modal stack via the FAB.
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-type-date_idea").click();

  const listName = `E2E list ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Skip the share step in the create-list flow.
  await expect(page.getByTestId("create-list-share-done")).toBeVisible();
  await page.getByTestId("create-list-share-done").click();

  // Land on list detail; empty state is visible.
  await expect(page.getByTestId("list-detail-empty-add")).toBeVisible();
  await page.getByTestId("list-detail-empty-add").click();

  const itemTitle = `Picnic at the park ${Date.now()}`;
  await page.getByTestId("add-item-title").fill(itemTitle);
  await page.getByTestId("add-item-submit").click();

  // The new item lands in the unordered section.
  const itemRow = page.locator('[data-testid^="item-row-"]').first();
  await expect(itemRow).toBeVisible();
  await expect(page.getByTestId("list-detail-section-unordered")).toBeVisible();

  // Open kebab → promote to ordered (top). Item moves to the ORDERED section.
  await itemRow.locator('[data-testid^="item-row-menu-"]').click();
  await page.getByTestId("item-row-menu-promote-top").click();
  await expect(page.getByTestId("list-detail-section-ordered")).toBeVisible();

  // Open kebab → mark complete. Item moves to the COMPLETED section.
  await itemRow.locator('[data-testid^="item-row-menu-"]').click();
  await page.getByTestId("item-row-menu-complete").click();
  await expect(page.getByTestId("list-detail-section-completed")).toBeVisible();
});
