import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// Happy-path: sign in via the dev backdoor → set a display name → land on home.
//
// Relies on `DEV_AUTH_ENABLED=1` (backend) + `EXPO_PUBLIC_DEV_AUTH=1` (web)
// being set when the dev servers start. These make the dev sign-in button
// visible and the `POST /v1/auth/dev` endpoint reachable. The auto-dev-sign-in
// boot path is disabled per-test via the helper so the sign-in screen renders.
//
// This realizes "one Playwright happy-path with a mocked JWT verifier" from
// docs/redesign-plan.md §3.1 0b-2: the dev route creates/finds a user by a
// synthetic `dev:<email>` provider_sub without hitting real Apple/Google JWKS.

test("dev sign-in → display name → home", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto("/");

  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  const input = page.getByTestId("display-name-input");
  await expect(input).toBeVisible();
  await input.fill("E2E User");
  await page.getByTestId("display-name-save").click();

  await expect(page.getByTestId("home-greeting")).toHaveText(/E2E User/);
});
