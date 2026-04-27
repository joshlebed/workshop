import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path for chunk 2b-1: dev-sign-in → create movie list → search →
// add a movie via the search modal → verify it lands on the list.
//
// The backend's TMDB_API_KEY is unset in dev, so `GET /v1/search/media` would
// return 500. We mock it directly to a fixed result set — the test is about
// the client wiring (debounce → fetch → render → select → POST), not TMDB
// itself (covered by `apps/backend/src/routes/v1/search.test.ts`).

const MEDIA_FIXTURE = {
  results: [
    {
      id: "603",
      title: "The Matrix",
      year: 1999,
      posterUrl: "https://image.tmdb.org/t/p/w500/matrix.jpg",
      overview: "A computer hacker learns the truth.",
    },
    {
      id: "604",
      title: "The Matrix Reloaded",
      year: 2003,
      posterUrl: null,
      overview: null,
    },
  ],
};

test("create movie list → search → add via search result", async ({ page }) => {
  await disableAutoDevSignIn(page);

  await page.route("**/v1/search/media**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MEDIA_FIXTURE),
    });
  });

  await page.goto("/");

  // Sign in via the dev backdoor + onboard if needed. Wait for whichever
  // screen renders first — display-name on a fresh user, home-greeting on
  // an already-onboarded one.
  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  await Promise.race([
    page.getByTestId("display-name-input").waitFor({ state: "visible" }),
    page.getByTestId("home-greeting").waitFor({ state: "visible" }),
  ]);

  if (await page.getByTestId("display-name-input").isVisible()) {
    await page.getByTestId("display-name-input").fill("E2E Search");
    await page.getByTestId("display-name-save").click();
  }

  await expect(page.getByTestId("home-greeting")).toBeVisible();

  // Create a movie-typed list.
  await page.getByTestId("fab-create-list").click();
  await page.getByTestId("create-list-type-movie").click();

  const listName = `E2E movies ${Date.now()}`;
  await page.getByTestId("create-list-name").fill(listName);
  await page.getByTestId("create-list-submit").click();

  // Skip the share step in the create-list flow.
  await expect(page.getByTestId("create-list-share-done")).toBeVisible();
  await page.getByTestId("create-list-share-done").click();

  // Land on list detail; open the add flow.
  await expect(page.getByTestId("empty-add-item")).toBeVisible();
  await page.getByTestId("empty-add-item").click();

  // The search input should be visible (movie list → search flow, not free-form).
  const searchInput = page.getByTestId("add-item-search");
  await expect(searchInput).toBeVisible();

  // Type a query — debounced 300ms → fetch → render result rows.
  await searchInput.fill("matrix");

  const matrixRow = page.getByTestId("search-result-603");
  await expect(matrixRow).toBeVisible();
  await expect(matrixRow).toContainText("The Matrix (1999)");

  // Add the first result.
  await page.getByTestId("search-result-603-add").click();

  // After add, screen pops back to list detail; the new item is on the list.
  const itemRow = page.locator('[data-testid^="item-row-"]').first();
  await expect(itemRow).toBeVisible();
  await expect(itemRow).toContainText("The Matrix");
});
