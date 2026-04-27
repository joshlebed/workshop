import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// Happy-path for chunk 3b-1: list owner generates a share link from the
// settings sheet, a second browser context lands on the invite URL signed
// in as a different user, accepts, and ends up on the list detail screen.
//
// The dev sign-in button hardcodes a single email, so we mint two separate
// dev sessions via the /v1/auth/dev backdoor (see signInAsDevUser) and seed
// each context's localStorage with its own session token before page.goto.

test("share-link invite: owner generates → guest accepts via deep link", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const ownerCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  const guestPage = await guestCtx.newPage();

  await signInAsDevUser(ownerPage, request, {
    email: `share-owner-${stamp}@workshop.local`,
    displayName: "Share Owner",
  });
  await signInAsDevUser(guestPage, request, {
    email: `share-guest-${stamp}@workshop.local`,
    displayName: "Share Guest",
  });

  // Owner: create a list and open settings.
  await ownerPage.goto("/");
  await expect(ownerPage.getByTestId("home-greeting")).toBeVisible();
  await ownerPage.getByTestId("fab-create-list").click();
  await ownerPage.getByTestId("create-list-type-trip").click();

  const listName = `Share trip ${stamp}`;
  await ownerPage.getByTestId("create-list-name").fill(listName);
  await ownerPage.getByTestId("create-list-submit").click();

  // Skip the share step in the create-list flow; the test exercises the
  // settings-sheet share path instead.
  await expect(ownerPage.getByTestId("create-list-share-done")).toBeVisible();
  await ownerPage.getByTestId("create-list-share-done").click();

  await expect(ownerPage.getByTestId("list-settings")).toBeVisible();
  await ownerPage.getByTestId("list-settings").click();

  // Owner: generate a share link and read its URL out of the on-screen field.
  await expect(ownerPage.getByTestId("settings-generate-link")).toBeVisible();
  await ownerPage.getByTestId("settings-generate-link").click();
  await expect(ownerPage.getByTestId("settings-fresh-invite-url")).toBeVisible();
  const shareUrl = await ownerPage.getByTestId("settings-fresh-invite-url").textContent();
  expect(shareUrl).toBeTruthy();
  const inviteUrl = (shareUrl ?? "").trim();
  // Strip the origin so we hit the SAME web bundle the test runs against (the
  // displayed URL may bake in window.location.origin which the guest already
  // navigates to via baseURL).
  const path = new URL(inviteUrl).pathname;
  const search = new URL(inviteUrl).search;

  // Guest: navigate to the invite path; accept-invite picks up the token,
  // joins the list, and replaces the route to /list/<id>.
  await guestPage.goto(`${path}${search}`);
  await guestPage.waitForURL(/\/list\/[^/]+$/, { timeout: 15_000 });
  await expect(guestPage.getByTestId("list-settings")).toBeVisible();

  // Guest: open settings and confirm both members are visible. Guest is not
  // the owner, so the Members card renders without remove buttons but with
  // both rows present.
  await guestPage.getByTestId("list-settings").click();
  await expect(guestPage.getByText("Share Owner")).toBeVisible();
  await expect(guestPage.getByText(/Share Guest/)).toBeVisible();

  await ownerCtx.close();
  await guestCtx.close();
});
