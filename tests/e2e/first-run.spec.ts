import {
  cleanupScratchUser,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// UX pass 4.1–4.3, journey "first list from a cold install" (plan §5): a
// brand-new account goes sign-in → display name → empty home → one-tap starter
// → first item. Target: 4 taps + 1 text entry or better.
//
// The provider tap is simulated by minting a scratch dev session (no display
// name) and seeding it. The starter list keeps its template name ("To-do")
// because that is what is under test; cleanup renames it into the scratch
// namespace and deletes it.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;
test.afterAll(async () => cleanupScratchUser(user));

test("first list from empty home", async ({ page }) => {
  user = await mintScratchUser("first", { displayName: null });
  expect(user.needsDisplayName).toBe(true);
  await seedSession(page, user.token);
  await page.goto("/");

  // Display name: a heading, the field, Return submits.
  await expect(page.getByTestId("display-name-input")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByTestId("display-name-input").fill("Mira");
  await page.getByTestId("display-name-input").press("Enter");

  // Empty home teaches: one sentence, starters, no FAB.
  await expect(page.getByTestId("home-empty")).toBeVisible();
  await expect(page.getByTestId("fab-create-list")).toHaveCount(0);

  // One tap makes a ready list and opens its add surface.
  await page.getByTestId("home-starter-shared_todo").click();
  await page.waitForURL(/\/list\/[^/]+\/add$/);
  await page.getByTestId("add-item-title").fill("Buy film");
  await page.getByTestId("add-item-title").press("Enter");
  await page.getByTestId("add-item-cancel").click();

  await page.waitForURL(/\/list\/[^/]+$/);
  await expect(page.locator('[data-testid^="item-title-"]', { hasText: "Buy film" })).toBeVisible();
  await expect(page.getByTestId("list-detail-name")).toHaveText("To-do");

  // Back goes home, where the new list now sits.
  await page.getByTestId("list-detail-back").click();
  await page.waitForURL(/\/$/);
  await expect(
    page.locator('[data-testid^="list-card-"]', { hasText: "To-do" }).first(),
  ).toBeVisible();
});
