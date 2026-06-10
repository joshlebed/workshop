import { expect, type Page, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// G3 (issue #293): friends-first onboarding + game discovery. Two fresh dev
// users:
//   • B opens the Games home with no friends and no games → the empty state
//     pushes "Add friends" as the primary CTA.
//   • A adds two games and mints a friend invite. B accepts → the post-accept
//     picker lists A's games → B adds one → it renders on B's home with today's
//     standings (A's score shows through the social board).
//   • With the friendship formed and one game still unadded, B's + sheet lists
//     that game as a suggestion above the URL field.
//
// Unique hostnames + fresh emails per run, so a dirty dev DB never collides.

test("games onboarding: empty state → accept → picker add → + sheet discovery", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const host1 = `e2e-onb-one-${stamp}.example.com`;
  const host2 = `e2e-onb-two-${stamp}.example.com`;
  const url1 = `https://${host1}/daily`;
  const url2 = `https://${host2}/daily`;
  const aScore = "Daily #3\n🟩🟩🟩\nScore: 9";

  const aCtx = await browser.newContext();
  const bCtx = await browser.newContext();
  const aPage = await aCtx.newPage();
  const bPage = await bCtx.newPage();

  const aAuth = await signInAsDevUser(aPage, request, {
    email: `onb-a-${stamp}@workshop.local`,
    displayName: "Onboard Ada",
  });
  const bAuth = await signInAsDevUser(bPage, request, {
    email: `onb-b-${stamp}@workshop.local`,
    displayName: "Onboard Bo",
  });

  // B (no friends, no games) → empty state pushes Add friends first.
  await goToGames(bPage);
  await expect(bPage.getByTestId("games-onboarding")).toBeVisible();
  await expect(bPage.getByTestId("games-empty-add-friends")).toBeVisible();
  await expect(bPage.getByTestId("games-empty-add-url")).toBeVisible();

  // A adds two games (and posts a score on the first, so B later sees standings).
  await goToGames(aPage);
  const gameId1 = await addGameByUrl(aPage, host1, url1);
  await postScore(aPage, gameId1, aScore);
  const gameId2 = await addGameByUrl(aPage, host2, url2);
  expect(gameId2).not.toBe(gameId1);

  // A mints a friend invite from the Friends screen.
  await aPage.getByTestId("games-friends-button").click();
  await expect(aPage.getByTestId("friends-screen")).toBeVisible();
  await aPage.getByTestId("friends-invite-button").click();
  await expect(aPage.getByTestId("friends-invite-url")).toBeVisible();
  const inviteUrl = ((await aPage.getByTestId("friends-invite-url").textContent()) ?? "").trim();
  expect(inviteUrl).toContain("/friends/accept/");
  const acceptPath = new URL(inviteUrl).pathname;

  // B accepts → the post-accept picker lists A's games.
  await bPage.goto(acceptPath);
  await expect(bPage.getByTestId("friend-accept")).toBeVisible();
  await expect(bPage.getByTestId("friend-accept")).toContainText("Onboard Ada");
  await bPage.getByTestId("friend-accept-button").click();

  await expect(bPage.getByTestId("friend-accept-picker")).toBeVisible();
  await expect(bPage.getByTestId(`friend-accept-suggestion-row-${gameId1}`)).toBeVisible();
  await expect(bPage.getByTestId(`friend-accept-suggestion-row-${gameId2}`)).toBeVisible();

  // Add the first game one-tap → the row flips to "Added".
  await bPage.getByTestId(`friend-accept-suggestion-add-${gameId1}`).click();
  await expect(bPage.getByTestId(`friend-accept-suggestion-added-${gameId1}`)).toBeVisible();

  // Finish onboarding → land on the populated Games home.
  await bPage.getByTestId("friend-accept-picker-done").click();
  await expect(bPage.getByTestId("games-home")).toBeVisible();

  // The added game renders on B's home with today's standings — A's score shows
  // through the social board (friendship + shared game).
  await expect(cardBody(bPage, host1)).toBeVisible();
  await expect
    .poll(async () => bPage.getByTestId(`game-card-score-${aAuth.user.id}`).count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await expect(bPage.getByTestId(`game-card-score-${aAuth.user.id}`)).toContainText("Score: 9");

  // With ≥1 friend, the + sheet lists the still-unadded friend game above the
  // URL field.
  await bPage.getByTestId("fab-add-game").click();
  await expect(bPage.getByTestId("add-game-sheet")).toBeVisible();
  await expect(bPage.getByTestId(`add-game-suggestion-row-${gameId2}`)).toBeVisible();
  await expect(bPage.getByTestId("add-game-url-input")).toBeVisible();
  // The already-added game is NOT re-suggested.
  await expect(bPage.getByTestId(`add-game-suggestion-row-${gameId1}`)).toHaveCount(0);

  // Reference bAuth so the lint/types treat it as used even if assertions shift.
  expect(bAuth.user.id).toBeTruthy();

  await aCtx.close();
  await bCtx.close();
});

// The second empty-state variant: a user who has a friend but no games yet
// (e.g. just accepted an invite and skipped the picker). The home surfaces the
// friend's games as one-tap suggestions instead of the add-friends pitch.
test("games onboarding: friends-but-no-games empty state adds a suggestion", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const host = `e2e-onb-vb-${stamp}.example.com`;
  const url = `https://${host}/daily`;

  const aCtx = await browser.newContext();
  const bCtx = await browser.newContext();
  const aPage = await aCtx.newPage();
  const bPage = await bCtx.newPage();

  await signInAsDevUser(aPage, request, {
    email: `onb-vb-a-${stamp}@workshop.local`,
    displayName: "Variant Ada",
  });
  await signInAsDevUser(bPage, request, {
    email: `onb-vb-b-${stamp}@workshop.local`,
    displayName: "Variant Bo",
  });

  // A adds one game and mints an invite.
  await goToGames(aPage);
  const gameId = await addGameByUrl(aPage, host, url);
  await aPage.getByTestId("games-friends-button").click();
  await expect(aPage.getByTestId("friends-screen")).toBeVisible();
  await aPage.getByTestId("friends-invite-button").click();
  await expect(aPage.getByTestId("friends-invite-url")).toBeVisible();
  const inviteUrl = ((await aPage.getByTestId("friends-invite-url").textContent()) ?? "").trim();
  const acceptPath = new URL(inviteUrl).pathname;

  // B accepts but SKIPS the picker ("Maybe later") → lands on the Games home
  // with a friend but no games → the suggestions empty state.
  await bPage.goto(acceptPath);
  await expect(bPage.getByTestId("friend-accept-button")).toBeVisible();
  await bPage.getByTestId("friend-accept-button").click();
  await expect(bPage.getByTestId("friend-accept-picker")).toBeVisible();
  await bPage.getByTestId("friend-accept-picker-done").click();

  await expect(bPage.getByTestId("games-home")).toBeVisible();
  await expect(bPage.getByTestId("games-onboarding")).toBeVisible();
  // Friends-but-no-games variant: A's game is a suggestion; no add-friends CTA.
  await expect(bPage.getByTestId(`games-empty-suggestion-row-${gameId}`)).toBeVisible();
  await expect(bPage.getByTestId("games-empty-add-url")).toBeVisible();
  await expect(bPage.getByTestId("games-empty-add-friends")).toHaveCount(0);

  // One-tap add the suggestion → the home flips to the populated card list.
  await bPage.getByTestId(`games-empty-suggestion-add-${gameId}`).click();
  await expect(cardBody(bPage, host)).toBeVisible();

  await aCtx.close();
  await bCtx.close();
});

/** From home → Games surface via the web tab switch. */
async function goToGames(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("home-greeting")).toBeVisible();
  await page.getByTestId("tab-switch-games").click();
  await expect(page.getByTestId("games-home")).toBeVisible();
}

/** Add a game by URL and return its global game id. */
async function addGameByUrl(page: Page, host: string, url: string): Promise<string> {
  await page.getByTestId("fab-add-game").click();
  await page.getByTestId("add-game-url-input").fill(url);
  await page.getByTestId("add-game-submit").click();
  await expect(cardBody(page, host)).toBeVisible();
  // Wait the add sheet's modal out before the next interaction.
  await expect(page.getByTestId("add-game-sheet")).toBeHidden();
  return cardIdFor(page, host);
}

/** Post a score onto today's card for `gameId`. */
async function postScore(page: Page, gameId: string, score: string): Promise<void> {
  await page.getByTestId(`game-card-paste-${gameId}`).click();
  await expect(page.getByTestId("game-paste-sheet")).toBeVisible();
  await page.getByTestId("game-paste-input").fill(score);
  await page.getByTestId("game-paste-submit").click();
  await expect(
    page.getByTestId(`game-card-${gameId}`).locator('[data-testid^="game-card-score-"]'),
  ).toContainText("Score:");
}

/** The card body (title block) for the card titled `host`. */
function cardBody(page: Page, host: string) {
  return page.locator('[data-testid^="game-card-body-"]', { hasText: host });
}

async function cardIdFor(page: Page, host: string): Promise<string> {
  const id = await cardBody(page, host).getAttribute("data-testid");
  if (!id) throw new Error(`no game card titled ${host}`);
  return id.replace("game-card-body-", "");
}
