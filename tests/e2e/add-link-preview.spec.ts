import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path for chunk 2b-2: dev-sign-in → create date-idea list → paste a URL
// in the add-item form → see the inline link preview → save the item.
//
// `/v1/link-preview` is mocked so the spec doesn't depend on a live backend
// fetcher (covered separately by apps/backend/src/routes/v1/link-preview.test.ts).

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

test("create date-idea list → paste URL → see preview → save", async ({ page }) => {
  await disableAutoDevSignIn(page);

  await page.route("**/v1/link-preview**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PREVIEW_FIXTURE),
    });
  });

  await page.goto("/");

  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  // Race the post-sign-in branches — fresh user vs already-onboarded — so the
  // spec survives a dirty dev DB. Same pattern as add-search.spec.ts.
  await Promise.race([
    page.getByTestId("display-name-input").waitFor({ state: "visible" }),
    page.getByTestId("home-greeting").waitFor({ state: "visible" }),
  ]);

  if (await page.getByTestId("display-name-input").isVisible()) {
    await page.getByTestId("display-name-input").fill("E2E Preview");
    await page.getByTestId("display-name-save").click();
  }

  await expect(page.getByTestId("home-greeting")).toBeVisible();

  // Create a date-idea list (free-form flow).
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-type-date_idea").click();

  const listName = `E2E preview ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Skip the share step in the create-list flow.
  await expect(page.getByTestId("create-list-share-done")).toBeVisible();
  await page.getByTestId("create-list-share-done").click();

  await expect(page.getByTestId("empty-add-item")).toBeVisible();
  await page.getByTestId("empty-add-item").click();

  // Free-form fields are visible (date_idea → free-form, not search).
  const titleInput = page.getByTestId("add-item-title");
  const urlInput = page.getByTestId("add-item-url");
  await expect(titleInput).toBeVisible();
  await expect(urlInput).toBeVisible();

  await titleInput.fill("Picnic at the park");
  await urlInput.fill("https://example.com/picnic");

  // Inline preview card appears after the 300ms debounce → mocked fetch.
  const previewCard = page.getByTestId("link-preview-card");
  await expect(previewCard).toBeVisible();
  await expect(page.getByTestId("link-preview-title")).toContainText("Picnic in the park");

  // Submit the item.
  await page.getByTestId("add-item-submit").click();

  // Back on list detail; the new item is on the list.
  const itemRow = page.locator('[data-testid^="item-row-"]').first();
  await expect(itemRow).toBeVisible();
  await expect(itemRow).toContainText("Picnic at the park");
});
