import { expect, test } from "@playwright/test";
import { disableAutoDevSignIn } from "./helpers";

// UX pass 4.1–4.3: a brand-new account goes sign-in → display name → empty
// home → one-tap starter → first item. Target: first list from a cold
// install in 4 taps + 1 text entry or better (docs/ux-pass-plan.md §5).
//
// The provider tap is simulated by minting a dev session (no display name)
// and seeding it, the same backdoor `signInAsDevUser` uses.

test("first list from empty home", async ({ page, request }) => {
  const stamp = Date.now();
  const resp = await request.post("http://localhost:8787/v1/auth/dev", {
    data: { email: `ux-scratch-e2e-first-${stamp}@workshop.local` },
  });
  expect(resp.ok()).toBe(true);
  const { token, needsDisplayName } = (await resp.json()) as {
    token: string;
    needsDisplayName: boolean;
  };
  expect(needsDisplayName).toBe(true);

  await disableAutoDevSignIn(page);
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("workshop.session.v1", t);
  }, token);
  await page.goto("/");

  // Display name: a heading, the field, Return submits.
  await expect(page.getByRole("heading", { name: "What should people call you?" })).toBeVisible();
  await page.getByTestId("display-name-input").fill("Mira");
  await page.getByTestId("display-name-input").press("Enter");

  // Empty home teaches: one sentence, starters, no FAB.
  await expect(page.getByTestId("home-empty")).toBeVisible();
  await expect(page.getByTestId("fab-create-list")).toHaveCount(0);

  // One tap makes a ready list and opens its add surface.
  await page.getByTestId("home-starter-shared_todo").click();
  await page.waitForURL(/\/list\/[^/]+\/add$/);
  await page.getByTestId("add-item-title").fill("Buy film");
  await page.getByTestId("add-item-title").press("Enter");
  await page.getByTestId("add-item-cancel").click();

  await page.waitForURL(/\/list\/[^/]+$/);
  await expect(page.getByText("Buy film")).toBeVisible();
  await expect(page.getByTestId("list-detail-name")).toHaveText("To-do");

  // Back goes home, where the new list now sits.
  await page.getByTestId("list-detail-back").click();
  await page.waitForURL(/\/$/);
  await expect(page.getByText("To-do")).toBeVisible();
});
