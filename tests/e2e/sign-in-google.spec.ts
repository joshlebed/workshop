import {
  api,
  disableAutoDevSignIn,
  expect,
  mintScratchUser,
  mockGoogleAuthEndpoint,
  stubGoogleIdentityServices,
  test,
} from "./helpers";

// Stub Google Identity Services with a known JWT, click "Continue with
// Google", then ride through display name → home.
//
// The GIS stub feeds a deterministic credential string into the production
// callback path. `/v1/auth/google` is mocked to return a real backend
// AuthResponse for a brand-new scratch user (minted via `/v1/auth/dev`), so the
// session token is signed by the running server and the display-name PATCH
// succeeds against that scratch account.

const STUB_JWT = "stub.gis.credential.from.playwright";

test("google sign-in (GIS stub) → display name → home", async ({ page }) => {
  const user = await mintScratchUser("google", { displayName: null });
  expect(user.needsDisplayName).toBe(true);
  const { email: _email, headers: _headers, lane: _lane, ...authResponse } = user;

  await disableAutoDevSignIn(page);
  await stubGoogleIdentityServices(page, STUB_JWT);
  await mockGoogleAuthEndpoint(page, authResponse);

  await page.goto("/");

  // Google renders only when the bundle has a web client id (UX pass 4.5);
  // the sandbox's dev server is started without one.
  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  test.skip(
    (await page.getByTestId("sign-in-google").count()) === 0,
    "Google sign-in is not configured on this web bundle (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID unset)",
  );
  await expect(page.getByTestId("sign-in-google")).toBeEnabled();
  await page.getByTestId("sign-in-google").click();

  const input = page.getByTestId("display-name-input");
  await expect(input).toBeVisible();
  await input.fill("Google E2E User");
  await page.getByTestId("display-name-save").click();

  await expect(page.getByTestId("home-empty")).toBeVisible();
  const me = await api<{ user: { displayName: string | null } }>(user, "GET", "/v1/auth/me");
  expect(me.user.displayName).toBe("Google E2E User");
});
