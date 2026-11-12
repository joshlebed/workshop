import {
  api,
  cleanupScratchUser,
  createScratchList,
  disableAutoDevSignIn,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
  toast,
} from "./helpers";

// UX pass 4.4: the share extension's picker. `_layout.tsx` turns the native
// payload into `/share?url=&text=`, which these tests drive directly. One
// scratch user per file; every list it ends up owning is deleted afterwards.

test.use({ viewport: { width: 390, height: 844 } });

let user: ScratchUser | null = null;

test.beforeAll(async () => {
  user = await mintScratchUser("share", { displayName: "Sharer" });
});

test.afterAll(async () => cleanupScratchUser(user));

test("a link saves into a list in one tap and lands there", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  const list = await createScratchList(user, {
    name: `zz-ux-scratch-e2e Dates ${Date.now()}`,
    emoji: "💜",
    color: "rose",
    itemKind: "link",
  });

  await page.goto(
    `/share?url=${encodeURIComponent("https://example.com/taqueria")}&text=${encodeURIComponent("Tacos on Friday?")}`,
  );
  await expect(page.getByTestId("share-pick-url")).toContainText("example.com");
  await page.getByTestId(`share-pick-row-${list.id}`).click();

  await page.waitForURL(new RegExp(`/list/${list.id}$`));
  await expect(toast(page, list.name)).toBeVisible();

  const items = await api<{ unordered: { url: string | null; kind: string }[] }>(
    user,
    "GET",
    `/v1/lists/${list.id}/items`,
  );
  expect(items.unordered[0]).toMatchObject({ url: "https://example.com/taqueria", kind: "link" });

  // The next share puts that list first, marked.
  await page.goto(`/share?url=${encodeURIComponent("https://example.org/picnic")}`);
  await expect(page.getByTestId("share-pick-last-used")).toBeVisible();
});

test("New list carries the shared link to the new list's add surface", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
  await page.goto(`/share?url=${encodeURIComponent("https://example.org/picnic")}`);
  await page.getByTestId("share-pick-create-new").click();
  await page.waitForURL(/\/create-list\/type\?url=/);
  await page.getByTestId("create-list-template-trip_plan").click();
  await page.waitForURL(/\/list\/[^/]+\/add\?prefillUrl=/);
  await expect(page.getByTestId("add-item-title")).toHaveValue("https://example.org/picnic");
});

test("a share that arrives signed out waits for sign-in", async ({ page }) => {
  await disableAutoDevSignIn(page);
  await page.goto(`/share?url=${encodeURIComponent("https://example.net/bakery")}`);
  await page.waitForURL(/\/sign-in$/);
  await expect(page.getByTestId("sign-in-share-context")).toContainText("example.net");
  const stash = await page.evaluate(() => window.localStorage.getItem("workshop.pending-share"));
  expect(stash).toContain("https://example.net/bakery");
});
