import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// UX pass 4.1 + 4.6: a new user opens a share link signed out, sees the list
// on the sign-in screen ("Sign in to join …"), signs up, names themself, comes
// back to the landing and joins with one explicit tap. Target: 4 taps, lands
// in the list (docs/ux-pass-plan.md §5).

test("new user joins from a share link", async ({ page, request }) => {
  const stamp = Date.now();
  const api = "http://localhost:8787";
  const owner = await request.post(`${api}/v1/auth/dev`, {
    data: { email: `ux-scratch-e2e-owner-${stamp}@workshop.local`, displayName: "Renata" },
  });
  const ownerToken = ((await owner.json()) as { token: string }).token;
  const auth = { Authorization: `Bearer ${ownerToken}` };
  const listName = `zz-ux-scratch-e2e Date ideas ${stamp}`;
  const created = await request.post(`${api}/v1/lists`, {
    headers: auth,
    data: { name: listName, emoji: "💜", color: "rose", itemKind: "link", modules: ["todo"] },
  });
  const listId = ((await created.json()) as { list: { id: string } }).list.id;
  const share = await request.patch(`${api}/v1/lists/${listId}/share`, {
    headers: auth,
    data: { visibility: "join" },
  });
  const { shareSlug } = (await share.json()) as { shareSlug: string };

  // Signed out on the share link.
  await disableAutoDevSignIn(page);
  await page.goto(`/l/${shareSlug}`);
  await expect(page.getByTestId("list-landing-name")).toHaveText(listName);
  await page.getByTestId("list-landing-sign-in").click(); // tap 1
  await page.waitForURL(/\/sign-in$/);
  await expect(page.getByTestId("sign-in-list-context")).toContainText(
    `Sign in to join ${listName}`,
  );

  // Tap 2 is the provider button; simulated with a fresh dev session.
  const guest = await request.post(`${api}/v1/auth/dev`, {
    data: { email: `ux-scratch-e2e-guest-${stamp}@workshop.local` },
  });
  const guestToken = ((await guest.json()) as { token: string }).token;
  await page.evaluate((t) => window.localStorage.setItem("workshop.session.v1", t), guestToken);
  await page.reload();

  await page.getByTestId("display-name-input").fill("Theo");
  await page.getByTestId("display-name-save").click(); // tap 3

  // Back on the landing; joining is an explicit tap.
  await page.waitForURL(new RegExp(`/l/${shareSlug}$`));
  await page.getByTestId("list-landing-join").click(); // tap 4
  await page.waitForURL(new RegExp(`/list/${listId}$`));
  await expect(page.getByTestId("list-detail-name")).toHaveText(listName);

  await request.delete(`${api}/v1/lists/${listId}`, { headers: auth });
});
