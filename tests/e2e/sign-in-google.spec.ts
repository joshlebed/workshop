import { expect, test } from "@playwright/test";
import {
  disableAutoDevSignIn,
  mockGoogleAuthEndpoint,
  stubGoogleIdentityServices,
} from "./helpers";

// Happy-path for chunk 0c-2: stub Google Identity Services with a known JWT,
// click "Continue with Google", then ride through display-name → home.
//
// The GIS stub feeds a deterministic credential string into the production
// callback path in src/lib/oauth/google.web.ts. The /v1/auth/google endpoint
// is mocked to return a real backend AuthResponse (obtained via /v1/auth/dev)
// so the resulting session token is signed by the running server's
// SESSION_SECRET — that lets the subsequent PATCH /v1/users/me succeed.

const STUB_JWT = "stub.gis.credential.from.playwright";

test("google sign-in (GIS stub) → display name → home", async ({ page, request }) => {
  // Pull a real signed AuthResponse from the dev backdoor — we only need a
  // server-issued session token; the rest of the response shape (user,
  // needsDisplayName) is reused as-is so the client treats the flow as a
  // first-time sign-in.
  const devResp = await request.post("http://localhost:8787/v1/auth/dev", {
    data: { email: `google-stub-${Date.now()}@workshop.local`, displayName: null },
  });
  expect(devResp.ok()).toBe(true);
  const authResponse = await devResp.json();

  await disableAutoDevSignIn(page);
  await stubGoogleIdentityServices(page, STUB_JWT);
  await mockGoogleAuthEndpoint(page, authResponse);

  await page.goto("/");

  await expect(page.getByTestId("sign-in-google")).toBeEnabled();
  await page.getByTestId("sign-in-google").click();

  const input = page.getByTestId("display-name-input");
  await expect(input).toBeVisible();
  await input.fill("Google E2E User");
  await page.getByTestId("display-name-save").click();

  await expect(page.getByTestId("home-greeting")).toHaveText(/Google E2E User/);
});
