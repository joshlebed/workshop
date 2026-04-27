import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path for chunk 1b-2: dev-sign-in → create list → add item → upvote → complete.
//
// Reuses the dev sign-in backdoor seeded by `scripts/e2e.sh` (DEV_AUTH_ENABLED=1).
// Each run uses a unique list name so re-running against a dirty dev DB doesn't
// conflict with prior runs.

test("create list → add item → upvote → complete", async ({ page }) => {
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

  // Land on list detail; empty state is visible.
  await expect(page.getByTestId("empty-add-item")).toBeVisible();
  await page.getByTestId("empty-add-item").click();

  const itemTitle = `Picnic at the park ${Date.now()}`;
  await page.getByTestId("add-item-title").fill(itemTitle);
  await page.getByTestId("add-item-submit").click();

  // The new item shows up with upvote count of 1 (creator's auto-upvote).
  const itemRow = page.locator('[data-testid^="item-row-"]').first();
  await expect(itemRow).toBeVisible();
  const upvotePill = itemRow.locator('[data-testid^="item-upvote-"]');
  await expect(upvotePill).toContainText("1");

  // Toggle upvote off → count drops to 0 → toggle back on.
  await upvotePill.click();
  await expect(upvotePill).toContainText("0");
  await upvotePill.click();
  await expect(upvotePill).toContainText("1");

  // Complete the item — it should move out of the active list and into the
  // completed section.
  const completeBtn = itemRow.locator('[data-testid^="item-complete-"]');
  await completeBtn.click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
});
