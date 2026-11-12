import { expect, test } from "@playwright/test";

// UX pass phase 3 journeys (docs/ux-pass-plan.md §5): share a list in two taps
// and hide a list with Undo, plus the 3.8 back fallback for a cold-opened modal
// and the branded not-found page. Lists are made through the API, named
// `zz-ux-scratch-e2e-*`, and deleted afterwards. Relies on the auto dev sign-in
// (EXPO_PUBLIC_DEV_AUTH=1) and the backend's dev route (DEV_AUTH_ENABLED=1).

const API = process.env.WORKSHOP_E2E_API_URL ?? "http://localhost:8787";

let token = "";
let listId = "";
let listName = "";

test.beforeAll(async ({ request }) => {
  const auth = await request.post(`${API}/v1/auth/dev`, {
    data: { email: "joshlebed@gmail.com" },
    headers: { "X-Workshop-Client": "workshop" },
  });
  const body = (await auth.json()) as { token?: string; accessToken?: string };
  token = body.token ?? body.accessToken ?? "";
  listName = `zz-ux-scratch-e2e-nav-${Date.now()}`;
  const created = await request.post(`${API}/v1/lists`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: listName, emoji: "🧭", color: "ocean", itemKind: "plain", modules: ["todo"] },
  });
  listId = ((await created.json()) as { list: { id: string } }).list.id;
});

test.afterAll(async ({ request }) => {
  if (listId) {
    await request.delete(`${API}/v1/lists/${listId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
});

test.use({ viewport: { width: 390, height: 844 } });

test("share a list: two taps from the list", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/list/${listId}`);

  // Tap 1: the share button in the header. Tap 2: Share link.
  await page.getByTestId("list-detail-share").click();
  await expect(page.getByTestId("share-sheet")).toBeVisible();
  await page.getByTestId("share-sheet-share").click();
  // Headless Chromium has no Web Share, so the link is copied.
  await expect(page.getByText("Link copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/l\/[A-Za-z0-9]+$/);

  // Owners pick who the link lets in; the choice saves on tap.
  await page.getByTestId("list-detail-share").click();
  await page.getByTestId("share-visibility-view").click();
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/v1/lists/${listId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return ((await res.json()) as { list: { shareVisibility: string } }).list.shareVisibility;
    })
    .toBe("view");
  await page.getByTestId("share-visibility-join").click();
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/v1/lists/${listId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return ((await res.json()) as { list: { shareVisibility: string } }).list.shareVisibility;
    })
    .toBe("join");
});

test("hide a list from the home row menu, then undo", async ({ page }) => {
  await page.goto("/");
  const row = page.getByTestId(`list-card-${listId}`);
  await expect(row).toBeVisible();

  // The row menu opens from right-click (and long-press / the hover "more").
  await row.click({ button: "right" });
  await page.getByTestId("row-menu-hide").click();
  await expect(page.getByText(`Hidden “${listName}”`)).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByTestId("toast-action").click();
  await expect(row).toBeVisible();
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByTestId(`list-card-${listId}`)).toBeVisible();
});

test("a modal opened cold goes back to its list, not home", async ({ page }) => {
  await page.goto(`/list/${listId}/add`);
  await page.getByTestId("add-item-cancel").click();
  await expect(page).toHaveURL(new RegExp(`/list/${listId}$`));
  await page.getByTestId("list-detail-back").click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test("unknown routes show the branded not-found page", async ({ page }) => {
  await page.goto("/friends");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.getByTestId("not-found-home").click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});
