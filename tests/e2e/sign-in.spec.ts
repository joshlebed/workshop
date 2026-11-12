import { disableAutoDevSignIn, expect, redirectDevSignIn, scratchEmail, test } from "./helpers";

// Happy path: sign in via the dev backdoor → set a display name → land on home.
//
// Relies on `DEV_AUTH_ENABLED=1` (backend) + `EXPO_PUBLIC_DEV_AUTH=1` (web),
// which make the dev sign-in button visible and `POST /v1/auth/dev` reachable.
// The button hardcodes the real owner account, so the request is rewritten to
// a brand-new scratch email: same button, same route, no owner data touched.
// A new account has no lists, so home is the teaching empty state.

test("dev sign-in → display name → home", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await redirectDevSignIn(page, scratchEmail("sign-in"));
  await page.goto("/");

  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  const input = page.getByTestId("display-name-input");
  await expect(input).toBeVisible();
  await input.fill("E2E User");
  await page.getByTestId("display-name-save").click();

  await expect(page.getByTestId("home-empty")).toBeVisible();
  await expect(page.getByTestId("home-header")).toBeVisible();
});
