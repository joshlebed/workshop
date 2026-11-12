import {
  api,
  cleanupScratchUser,
  createScratchList,
  disableAutoDevSignIn,
  expect,
  mintScratchUser,
  type ScratchUser,
  test,
} from "./helpers";

// UX pass 4.1 + 4.6, journey "new user joins from a link" (plan §5): a new
// user opens a share link signed out, sees the list on the sign-in screen
// ("Sign in to join …"), signs up, names themself, comes back to the landing
// and joins with one explicit tap. Target: 4 taps, lands in the list.

test.use({ viewport: { width: 390, height: 844 } });

let owner: ScratchUser | null = null;
test.afterAll(async () => cleanupScratchUser(owner));

test("new user joins from a share link", async ({ page }) => {
  owner = await mintScratchUser("join-owner", { displayName: "Renata" });
  const list = await createScratchList(owner, {
    name: `zz-ux-scratch-e2e Date ideas ${Date.now()}`,
    emoji: "💜",
    color: "rose",
    itemKind: "link",
  });
  const { shareSlug } = await api<{ shareSlug: string }>(
    owner,
    "PATCH",
    `/v1/lists/${list.id}/share`,
    { visibility: "join" },
  );

  // Signed out on the share link.
  await disableAutoDevSignIn(page);
  await page.goto(`/l/${shareSlug}`);
  await expect(page.getByTestId("list-landing-name")).toHaveText(list.name);
  await page.getByTestId("list-landing-sign-in").click(); // tap 1
  await page.waitForURL(/\/sign-in$/);
  await expect(page.getByTestId("sign-in-list-context")).toContainText(list.name);

  // Tap 2 is the provider button; simulated with a fresh scratch session.
  const guest = await mintScratchUser("join-guest", { displayName: null });
  await page.evaluate((t) => window.localStorage.setItem("workshop.session.v1", t), guest.token);
  await page.reload();

  await page.getByTestId("display-name-input").fill("Theo");
  await page.getByTestId("display-name-save").click(); // tap 3

  // Back on the landing; joining is an explicit tap.
  await page.waitForURL(new RegExp(`/l/${shareSlug}$`));
  await page.getByTestId("list-landing-join").click(); // tap 4
  await page.waitForURL(new RegExp(`/list/${list.id}$`));
  await expect(page.getByTestId("list-detail-name")).toHaveText(list.name);
});
