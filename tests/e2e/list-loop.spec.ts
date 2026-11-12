import { expect, type Page, test } from "@playwright/test";

// UX pass phase 2 journeys (docs/ux-pass-plan.md §5): add five plain items
// in two taps + five Returns, complete with one tap and undo, delete and undo,
// and reorder from the row menu. The list is made through the API, named
// `zz-ux-scratch-e2e-*`, and deleted afterwards, so the run leaves nothing
// behind even on a prod-copy database. Relies on the auto dev sign-in
// (EXPO_PUBLIC_DEV_AUTH=1) and the backend's dev route (DEV_AUTH_ENABLED=1).

const API = process.env.WORKSHOP_E2E_API_URL ?? "http://localhost:8787";

let token = "";
let listId = "";

test.beforeAll(async ({ request }) => {
  const auth = await request.post(`${API}/v1/auth/dev`, {
    data: { email: "joshlebed@gmail.com" },
    headers: { "X-Workshop-Client": "workshop" },
  });
  const body = (await auth.json()) as { token?: string; accessToken?: string };
  token = body.token ?? body.accessToken ?? "";
  const created = await request.post(`${API}/v1/lists`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `zz-ux-scratch-e2e-${Date.now()}`,
      emoji: "✅",
      color: "forest",
      itemKind: "plain",
      modules: ["todo"],
    },
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

const titles = (page: Page) =>
  page.locator('[data-testid^="item-title-"]').evaluateAll((els) => els.map((e) => e.textContent));

test("add five by keyboard, complete + undo, delete + undo, move up", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/list/${listId}`);

  // Two taps (open add, close) and five Returns.
  await page.getByTestId("list-detail-empty-add").click();
  const field = page.getByTestId("add-item-title");
  await expect(field).toBeFocused();
  for (const n of ["One", "Two", "Three", "Four", "Five"]) {
    await page.keyboard.type(`Item ${n}`);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("add-item-added")).toContainText(`Item ${n}`);
    await expect(field).toHaveValue("");
  }
  await page.getByTestId("add-item-cancel").click();
  await expect
    .poll(() => titles(page))
    .toEqual(["Item Five", "Item Four", "Item Three", "Item Two", "Item One"]);

  // One tap completes; Undo puts it back where it was.
  const row = (title: string) =>
    page.locator('[data-testid^="item-row-"]', { has: page.getByText(title, { exact: true }) });
  await row("Item Three").locator('[data-testid^="item-row-check-"]').click();
  await expect(page.getByText("Marked done")).toBeVisible();
  await expect(page.getByTestId("list-detail-subline")).toContainText("4 to do");
  await page.getByTestId("toast-action").click();
  await expect(page.getByTestId("list-detail-subline")).toContainText("5 to do");

  // Delete has no confirm; Undo restores it.
  await row("Item Two").locator('[data-testid^="item-row-menu-"]').first().click();
  await page.getByTestId("item-row-menu-delete").click();
  await expect(page.getByText("Deleted “Item Two”")).toBeVisible();
  await page.getByTestId("toast-action").click();

  // Keyboard path for reorder.
  await row("Item One").locator('[data-testid^="item-row-menu-"]').first().click();
  await page.getByTestId("item-row-menu-up").click();

  await page.waitForTimeout(1500);
  await page.reload();
  await expect
    .poll(() => titles(page))
    .toEqual(["Item Five", "Item Four", "Item Three", "Item One", "Item Two"]);
});
