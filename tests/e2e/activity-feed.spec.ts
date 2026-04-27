import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// Happy-path for chunk 3b-2: actor (owner) adds an item to a shared list →
// other browser context (member) sees the resulting `item_added` event in
// /activity → the home bell badge clears after a tap.
//
// Two contexts as different dev users mirrors share-link-accept.spec.ts: the
// dev sign-in button hardcodes a single email so we mint two distinct sessions
// via /v1/auth/dev and seed each context's localStorage before page.goto.

test("activity feed: owner adds item → member sees event → unread badge clears", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  const memberPage = await memberCtx.newPage();

  await signInAsDevUser(ownerPage, request, {
    email: `activity-owner-${stamp}@workshop.local`,
    displayName: "Activity Owner",
  });
  await signInAsDevUser(memberPage, request, {
    email: `activity-member-${stamp}@workshop.local`,
    displayName: "Activity Member",
  });

  // Owner: create a list, generate a share link from the create-list flow.
  await ownerPage.goto("/");
  await expect(ownerPage.getByTestId("home-greeting")).toBeVisible();
  await ownerPage.getByTestId("fab-create-list").click();
  await ownerPage.getByTestId("create-list-type-trip").click();

  const listName = `Activity trip ${stamp}`;
  await ownerPage.getByTestId("create-list-name").fill(listName);
  await ownerPage.getByTestId("create-list-submit").click();

  // The post-customize screen is now the share step.
  await expect(ownerPage.getByTestId("create-list-share-generate")).toBeVisible();
  await ownerPage.getByTestId("create-list-share-generate").click();
  await expect(ownerPage.getByTestId("create-list-share-url")).toBeVisible();
  const shareUrl = (await ownerPage.getByTestId("create-list-share-url").textContent()) ?? "";
  expect(shareUrl).toBeTruthy();
  const inviteUrl = new URL(shareUrl.trim());

  // Member: accept the invite via the share path.
  await memberPage.goto(`${inviteUrl.pathname}${inviteUrl.search}`);
  await memberPage.waitForURL(/\/list\/[^/]+$/, { timeout: 15_000 });

  // Owner: dismiss the share step → land on the list → add an item.
  await ownerPage.getByTestId("create-list-share-done").click();
  await ownerPage.waitForURL(/\/list\/[^/]+$/, { timeout: 15_000 });

  // Member: navigate home, the bell should not show unread (member's own
  // member_joined event is filtered out as same-actor).
  await memberPage.goto("/");
  await expect(memberPage.getByTestId("open-activity")).toBeVisible();

  // Owner: add an item via the empty-state CTA.
  await expect(ownerPage.getByTestId("empty-add-item")).toBeVisible();
  await ownerPage.getByTestId("empty-add-item").click();
  const itemTitle = `Plan ${stamp}`;
  await ownerPage.getByTestId("add-item-title").fill(itemTitle);
  await ownerPage.getByTestId("add-item-submit").click();
  // Wait for the modal to close + the item row to land.
  await expect(ownerPage.locator('[data-testid^="item-row-"]').first()).toBeVisible();

  // Member: refresh home to pull the latest activity feed and confirm the
  // unread badge appears (item_added event surfaces for the non-actor).
  await memberPage.reload();
  await expect(memberPage.getByTestId("activity-unread-badge")).toBeVisible({ timeout: 15_000 });

  // Member: tap the bell, see the event in the feed.
  await memberPage.getByTestId("open-activity").click();
  await expect(memberPage.getByTestId("activity-feed")).toBeVisible();
  await expect(memberPage.getByText(new RegExp(itemTitle))).toBeVisible();

  // Member: navigate back home — the bell badge should be cleared.
  await memberPage.getByTestId("activity-back").click();
  await expect(memberPage.getByTestId("home-greeting")).toBeVisible();
  await expect(memberPage.getByTestId("activity-unread-badge")).toHaveCount(0);

  await ownerCtx.close();
  await memberCtx.close();
});
