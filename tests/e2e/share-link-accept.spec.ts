import {
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  newLanedContext,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// Share link, signed-in guest: the owner turns on "anyone with the link can
// join" in the share sheet and shares the link (copied, since headless
// Chromium has no Web Share); a second, already signed-in user opens it, sees
// the landing, joins with one tap and lands in the list, where list settings
// show both members. The signed-out new-user version of this journey is
// join-from-link.spec.ts.
//
// Two scratch users in two browser contexts; cleanup deletes the owner's list.

const PHONE = { width: 390, height: 844 };

let owner: ScratchUser | null = null;
let guest: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  owner = await mintScratchUser("share-owner", { displayName: "Share Owner" });
  guest = await mintScratchUser("share-guest", { displayName: "Share Guest" });
  listId = (await createScratchList(owner, { name: "share", emoji: "✈️", color: "sand" })).id;
});

test.afterAll(async () => cleanupScratchUser(owner));

test("share-link invite: owner shares → signed-in guest joins via the link", async ({
  browser,
}) => {
  if (!owner || !guest) throw new Error("no scratch users");
  const ownerCtx = await newLanedContext(browser, "share-owner");
  const guestCtx = await newLanedContext(browser, "share-guest");
  await ownerCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedSession(ownerCtx, owner.token);
  await seedSession(guestCtx, guest.token);
  const ownerPage = await ownerCtx.newPage();
  const guestPage = await guestCtx.newPage();
  await ownerPage.setViewportSize(PHONE);
  await guestPage.setViewportSize(PHONE);

  // Owner: share sheet → let people join → Share link (copies).
  await ownerPage.goto(`/list/${listId}`);
  await ownerPage.getByTestId("list-detail-share").click();
  await expect(ownerPage.getByTestId("share-sheet")).toBeVisible();
  await ownerPage.getByTestId("share-visibility-join").click();
  await ownerPage.getByTestId("share-sheet-share").click();
  await expect
    .poll(() => ownerPage.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/\/l\/[A-Za-z0-9]+$/);
  const shareUrl = new URL(await ownerPage.evaluate(() => navigator.clipboard.readText()));

  // Guest: open the link on this web bundle (the copied origin may differ).
  await guestPage.goto(shareUrl.pathname);
  await expect(guestPage.getByTestId("list-landing-name")).toBeVisible();
  await guestPage.getByTestId("list-landing-join").click();
  await guestPage.waitForURL(new RegExp(`/list/${listId}$`), { timeout: 15_000 });

  // Guest: list settings list both members.
  await guestPage.getByTestId("list-detail-settings").click();
  await expect(guestPage.getByTestId(`settings-member-${owner.user.id}`)).toBeVisible();
  await expect(guestPage.getByTestId(`settings-member-${guest.user.id}`)).toBeVisible();

  await ownerCtx.close();
  await guestCtx.close();
});
