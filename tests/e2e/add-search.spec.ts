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

// Search-backed lists: search → add a movie from the results → it lands on
// the list. The sandbox has no TMDB key, so `GET /v1/search/media` is mocked;
// the test is about the client wiring (debounce → fetch → render → select →
// POST), not TMDB itself (apps/backend/src/routes/v1/search.test.ts).
//
// A scratch user owns a `zz-ux-scratch-e2e-*` movie list; cleanup deletes it.

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

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  user = await mintScratchUser("search");
  listId = (
    await createScratchList(user, {
      name: "search",
      emoji: "🎬",
      color: "sunset",
      itemKind: "movie",
      modules: ["todo", "ranking"],
    })
  ).id;
});

test.afterAll(async () => cleanupScratchUser(user));

test("movie list → search → add via search result", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.route("**/v1/search/media**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MEDIA_FIXTURE),
    });
  });

  await page.goto(`/list/${listId}`);
  await page.getByTestId("list-detail-empty-add").click();

  // The search input (movie list → search flow, not free-form).
  const searchInput = page.getByTestId("add-item-search");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("matrix");

  const matrixRow = page.getByTestId("search-result-603");
  await expect(matrixRow).toBeVisible();
  await expect(matrixRow).toContainText("The Matrix");
  await expect(matrixRow).toContainText("1999");

  // Add the first result; the surface stays open, clears the search and
  // confirms the add inline (2.4).
  await page.getByTestId("search-result-603-add").click();
  await expect(page.getByTestId("add-item-added")).toContainText("The Matrix");
  await page.getByTestId("add-item-cancel").click();

  const row = page.locator(ITEM_ROWS).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("The Matrix");
});
