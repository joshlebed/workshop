import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path for chunk 4a-1: dev-sign-in → create date-idea list →
// simulate a share-extension hand-off by visiting `/share?url=…` →
// pick the list → land on add-item with the URL pre-filled and the
// link preview already rendered.
//
// `/v1/link-preview` is mocked so the spec doesn't depend on a live
// fetcher (covered separately by the backend route's vitest cases).
//
// Phase 4a-2 will land the native iOS share extension that deep-links
// `workshop://share?url=…` — same code path as `/share?url=…` on web,
// so this happy-path covers the JS surface end-to-end.

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

test("share entry → pick list → URL pre-filled in add screen", async ({ page }) => {
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

  await Promise.race([
    page.getByTestId("display-name-input").waitFor({ state: "visible" }),
    page.getByTestId("home-greeting").waitFor({ state: "visible" }),
  ]);

  if (await page.getByTestId("display-name-input").isVisible()) {
    await page.getByTestId("display-name-input").fill("E2E Sharer");
    await page.getByTestId("display-name-save").click();
  }

  await expect(page.getByTestId("home-greeting")).toBeVisible();

  // Seed a date-idea list to share into.
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-type-date_idea").click();

  const listName = `E2E share ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Skip the share step in the create-list flow.
  await expect(page.getByTestId("create-list-share-done")).toBeVisible();
  await page.getByTestId("create-list-share-done").click();

  // Back on list detail — confirm the new list landed before navigating away.
  await expect(page.getByTestId("empty-add-item")).toBeVisible();

  // Simulate the share-extension hand-off. `/share?url=…` is the canonical
  // entry point; expo-router's file-based routing matches both
  // `https://workshop.dev/share?url=…` (web) and `workshop://share?url=…`
  // (the native extension's deep-link target).
  const sharedUrl = "https://example.com/picnic";
  await page.goto(`/share?url=${encodeURIComponent(sharedUrl)}`);

  // The share-pick screen renders the list of lists with the shared URL on top.
  await expect(page.getByTestId("share-pick-list")).toBeVisible();
  await expect(page.getByTestId("share-pick-url")).toContainText(sharedUrl);

  // Pick the list we just created. The card is keyed off the list id; finding
  // it by the visible name is the simplest way to reach the row.
  const row = page.getByRole("button", { name: `Add to ${listName}` });
  await expect(row).toBeVisible();
  await row.click();

  // Land on the add-item screen with the URL pre-filled — the preview card
  // is fetched from the mocked endpoint after the 300ms debounce.
  const urlInput = page.getByTestId("add-item-url");
  await expect(urlInput).toHaveValue(sharedUrl);
  await expect(page.getByTestId("link-preview-card")).toBeVisible();
  await expect(page.getByTestId("link-preview-title")).toContainText("Picnic in the park");
});
