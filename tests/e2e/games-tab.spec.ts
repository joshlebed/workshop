import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn, signInAsDev } from "./helpers";

// G0 (issue #282): with EXPO_PUBLIC_ENABLE_GAMES on (scripts/e2e.sh exports
// it), the web sidebar switch renders and flips between the Lists home and
// the Games placeholder; the existing Lists surface keeps working after a
// round-trip. The flag-off shape (no switch at all) is covered by the
// production bundle, not this suite.

test("games tab: sidebar switch flips surfaces and lists still work", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  await signInAsDev(page, { displayName: "E2E Games Tester" });

  // Flag on → the sidebar switch is visible on the signed-in home.
  await expect(page.getByTestId("tab-switch-lists")).toBeVisible();
  await expect(page.getByTestId("tab-switch-games")).toBeVisible();

  // Switch to Games → placeholder home at /games.
  await page.getByTestId("tab-switch-games").click();
  await expect(page.getByTestId("games-home")).toBeVisible();
  await expect(page).toHaveURL(/\/games$/);

  // Deep-loading /games directly also lands on the placeholder.
  await page.reload();
  await expect(page.getByTestId("games-home")).toBeVisible();

  // Switch back to Lists → the existing home (FAB and all) still works.
  await page.getByTestId("tab-switch-lists").click();
  await expect(page.getByTestId("fab-create-list")).toBeVisible();
});
