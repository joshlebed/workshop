import { expect, type Page, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// UX pass 4.4: the share extension's picker. `_layout.tsx` turns the native
// payload into `/share?url=&text=`, which these tests drive directly.

const API = "http://localhost:8787";

async function newUser(page: Page, request: import("@playwright/test").APIRequestContext) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const resp = await request.post(`${API}/v1/auth/dev`, {
    data: { email: `ux-scratch-e2e-share-${stamp}@workshop.local`, displayName: "Sharer" },
  });
  const { token } = (await resp.json()) as { token: string };
  await disableAutoDevSignIn(page);
  await page.addInitScript(
    (t: string) => window.localStorage.setItem("workshop.session.v1", t),
    token,
  );
  return { auth: { Authorization: `Bearer ${token}` }, stamp };
}

test("a link saves into a list in one tap and lands there", async ({ page, request }) => {
  const { auth, stamp } = await newUser(page, request);
  const created = await request.post(`${API}/v1/lists`, {
    headers: auth,
    data: {
      name: `zz-ux-scratch-e2e Dates ${stamp}`,
      emoji: "💜",
      color: "rose",
      itemKind: "link",
      modules: ["todo"],
    },
  });
  const listId = ((await created.json()) as { list: { id: string } }).list.id;

  await page.goto(
    `/share?url=${encodeURIComponent("https://example.com/taqueria")}&text=${encodeURIComponent("Tacos on Friday?")}`,
  );
  await expect(page.getByTestId("share-pick-url")).toContainText("Saving from example.com");
  await page.getByTestId(`share-pick-row-${listId}`).click();

  await page.waitForURL(new RegExp(`/list/${listId}$`));
  await expect(page.getByText(/^Added to zz-ux-scratch-e2e Dates/)).toBeVisible();

  const items = await request.get(`${API}/v1/lists/${listId}/items`, { headers: auth });
  const body = (await items.json()) as { unordered: { url: string | null; kind: string }[] };
  expect(body.unordered[0]).toMatchObject({ url: "https://example.com/taqueria", kind: "link" });

  // The next share puts that list first, marked.
  await page.goto(`/share?url=${encodeURIComponent("https://example.org/picnic")}`);
  await expect(page.getByTestId("share-pick-last-used")).toBeVisible();

  await request.delete(`${API}/v1/lists/${listId}`, { headers: auth });
});

test("New list carries the shared link to the new list's add surface", async ({
  page,
  request,
}) => {
  await newUser(page, request);
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
