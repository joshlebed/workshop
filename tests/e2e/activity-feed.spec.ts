import {
  api,
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  newLanedContext,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// Activity: an owner adds an item to a shared list → the member's home bell
// shows unread → the feed shows the event under "New" → leaving the feed marks
// it read and clears the bell (UX pass 3.6: read on leave, not on open).
//
// Two scratch users in two browser contexts. The owner's list is made and
// shared through the API and the member joins through the API; the owner adds
// the item through the real add surface. Cleanup deletes the owner's lists.

const PHONE = { width: 390, height: 844 };

let owner: ScratchUser | null = null;
let member: ScratchUser | null = null;
let listId = "";

test.beforeAll(async () => {
  owner = await mintScratchUser("activity-owner", { displayName: "Activity Owner" });
  member = await mintScratchUser("activity-member", { displayName: "Activity Member" });
  listId = (await createScratchList(owner, { name: "activity", emoji: "✈️", color: "sand" })).id;
  const { shareSlug } = await api<{ shareSlug: string }>(
    owner,
    "PATCH",
    `/v1/lists/${listId}/share`,
    { visibility: "join" },
  );
  await api(member, "POST", `/v1/lists/by-slug/${shareSlug}/join`);
  // Start the member from a clean slate: the join itself is not unread.
  await api(member, "POST", "/v1/activity/read");
});

test.afterAll(async () => cleanupScratchUser(owner));

test("activity feed: owner adds item → member sees event → unread badge clears", async ({
  browser,
}) => {
  if (!owner || !member) throw new Error("no scratch users");
  const ownerCtx = await newLanedContext(browser, "activity-owner");
  const memberCtx = await newLanedContext(browser, "activity-member");
  await seedSession(ownerCtx, owner.token);
  await seedSession(memberCtx, member.token);
  const ownerPage = await ownerCtx.newPage();
  const memberPage = await memberCtx.newPage();
  await ownerPage.setViewportSize(PHONE);
  await memberPage.setViewportSize(PHONE);

  // Member: home, no unread yet.
  await memberPage.goto("/");
  await expect(memberPage.getByTestId(`list-card-${listId}`)).toBeVisible();
  await expect(memberPage.getByTestId("open-activity")).toBeVisible();
  await expect(memberPage.getByTestId("activity-unread-badge")).toHaveCount(0);

  // Owner: add an item through the add surface.
  await ownerPage.goto(`/list/${listId}`);
  await ownerPage.getByTestId("list-detail-empty-add").click();
  const itemTitle = `Plan ${Date.now()}`;
  await ownerPage.getByTestId("add-item-title").fill(itemTitle);
  await ownerPage.getByTestId("add-item-title").press("Enter");
  await expect(ownerPage.getByTestId("add-item-added")).toContainText(itemTitle);
  await ownerPage.getByTestId("add-item-cancel").click();

  // Member: still on home, the live poll (15s on web) brings the bell and the
  // row's unread count. Not a reload: a reload within 30s of the last fetch
  // restores the persisted cache as fresh and doesn't refetch (see report).
  await expect(memberPage.getByTestId("activity-unread-badge")).toBeVisible({ timeout: 25_000 });
  await expect(memberPage.getByTestId(`list-card-unread-${listId}`)).toBeVisible();

  // Member: open the feed; the event sits under the "New" divider.
  await memberPage.getByTestId("open-activity").click();
  await expect(memberPage.getByTestId("activity-feed")).toBeVisible();
  await expect(memberPage.getByTestId("activity-new-divider")).toBeVisible();
  await expect(memberPage.getByTestId("activity-feed").getByText(itemTitle)).toBeVisible();

  // Member: leave — the read marker moves and the bell clears.
  await memberPage.getByTestId("activity-back").click();
  await expect(memberPage.getByTestId("home-header")).toBeVisible();
  await expect(memberPage.getByTestId("activity-unread-badge")).toHaveCount(0);

  await ownerCtx.close();
  await memberCtx.close();
});
