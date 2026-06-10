import { expect, type Page, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// G2b (issue #286): the social-board acceptance criterion. Two dev users add
// the SAME daily game and each post a score, then A invites B via a share-link,
// B accepts via the deep link, and each user's score becomes visible to the
// other on both the home leaderboard card AND the per-game board.
//
// Both users are minted fresh per run (unique emails + game host), so a dirty
// dev DB never collides with this run's state.

interface DevUser {
  id: string;
  page: Page;
}

test("games social: A invites → B accepts → scores cross-show on card + board", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const host = `e2e-social-${stamp}.example.com`;
  const gameUrl = `https://${host}/daily`;
  const aScore = "Daily #7\n🟩🟩🟩\nScore: 11";
  const bScore = "Daily #7\n🟥🟨🟩\nScore: 22";

  const aCtx = await browser.newContext();
  const bCtx = await browser.newContext();
  const aPage = await aCtx.newPage();
  const bPage = await bCtx.newPage();

  const aAuth = await signInAsDevUser(aPage, request, {
    email: `social-a-${stamp}@workshop.local`,
    displayName: "Social Ada",
  });
  const bAuth = await signInAsDevUser(bPage, request, {
    email: `social-b-${stamp}@workshop.local`,
    displayName: "Social Bo",
  });
  const aUser: DevUser = { id: aAuth.user.id, page: aPage };
  const bUser: DevUser = { id: bAuth.user.id, page: bPage };

  // Both users add the same game and post their own score. Same normalized URL
  // → same global game id, so the home cards/boards reference one game.
  await goToGames(aPage);
  const gameId = await addGameAndPost(aPage, host, gameUrl, aScore);
  await goToGames(bPage);
  const gameIdB = await addGameAndPost(bPage, host, gameUrl, bScore);
  expect(gameIdB).toBe(gameId);

  // Before friendship each card shows only its owner — neither sees the other.
  await expect(aPage.getByTestId(`game-card-score-${bUser.id}`)).toHaveCount(0);
  await expect(bPage.getByTestId(`game-card-score-${aUser.id}`)).toHaveCount(0);

  // A opens Friends from the Games header and mints an invite link.
  await aPage.getByTestId("games-friends-button").click();
  await expect(aPage.getByTestId("friends-screen")).toBeVisible();
  await aPage.getByTestId("friends-invite-button").click();
  await expect(aPage.getByTestId("friends-invite-url")).toBeVisible();
  const inviteUrl = ((await aPage.getByTestId("friends-invite-url").textContent()) ?? "").trim();
  expect(inviteUrl).toContain("/friends/accept/");
  // Hit the same web bundle the test runs against (strip the baked-in origin).
  const acceptPath = new URL(inviteUrl).pathname;

  // B lands on the accept screen, sees the inviter, and accepts → /friends.
  await bPage.goto(acceptPath);
  await expect(bPage.getByTestId("friend-accept")).toBeVisible();
  await expect(bPage.getByTestId("friend-accept")).toContainText("Social Ada");
  await bPage.getByTestId("friend-accept-button").click();
  await expect(bPage.getByTestId("friends-screen")).toBeVisible();
  await expect(bPage.getByTestId(`friend-row-${aUser.id}`)).toBeVisible();

  // Each client only learns of the new edge/scores on its next fetch. The 30s
  // staleTime + persisted query cache would otherwise serve A its
  // pre-friendship empty snapshot (the live app catches up on the 15s poll).
  // From here on, drop the persisted cache on every load so each verification
  // navigation fetches fresh server state — exactly what a cold open shows.
  await alwaysFetchFresh(aPage);
  await alwaysFetchFresh(bPage);

  // A now sees B on the friends list too (symmetric edge).
  await aPage.reload();
  await expect(aPage.getByTestId("friends-screen")).toBeVisible();
  await expect(aPage.getByTestId(`friend-row-${bUser.id}`)).toBeVisible();

  // Home card: each user's card for the shared game now shows the other's row.
  await expectScoreOnCard(aPage, bUser.id, "Score: 22");
  await expectScoreOnCard(bPage, aUser.id, "Score: 11");

  // Per-game board: open the shared game and confirm the friend's ranked row.
  await openBoard(aPage, host);
  await expect(aPage.getByTestId(`game-board-row-${bUser.id}`)).toBeVisible();
  await expect(aPage.getByTestId(`game-board-score-${bUser.id}`)).toContainText("Score: 22");
  // A's own row is highlighted as "you".
  await expect(aPage.getByTestId(`game-board-row-${aUser.id}`)).toContainText("you");

  await openBoard(bPage, host);
  await expect(bPage.getByTestId(`game-board-row-${aUser.id}`)).toBeVisible();
  await expect(bPage.getByTestId(`game-board-score-${aUser.id}`)).toContainText("Score: 11");

  await aCtx.close();
  await bCtx.close();
});

/**
 * Clear the persisted react-query cache on every subsequent load, so each
 * verification navigation refetches from the server instead of rehydrating a
 * pre-friendship snapshot (30s staleTime). Race-free vs. a one-shot clear: the
 * init script runs before the app boots on every navigation.
 */
async function alwaysFetchFresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("workshop.query-cache.v1");
    } catch {
      // best-effort
    }
  });
}

/** From home → Games surface via the web tab switch. */
async function goToGames(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("home-greeting")).toBeVisible();
  await page.getByTestId("tab-switch-games").click();
  await expect(page.getByTestId("games-home")).toBeVisible();
}

/** Add a game by URL, post a score, and return the global game id. */
async function addGameAndPost(
  page: Page,
  host: string,
  url: string,
  score: string,
): Promise<string> {
  await page.getByTestId("fab-add-game").click();
  await page.getByTestId("add-game-url-input").fill(url);
  await page.getByTestId("add-game-submit").click();
  await expect(cardBody(page, host)).toBeVisible();
  const gameId = await cardIdFor(page, host);

  await page.getByTestId(`game-card-paste-${gameId}`).click();
  await expect(page.getByTestId("game-paste-sheet")).toBeVisible();
  await page.getByTestId("game-paste-input").fill(score);
  await page.getByTestId("game-paste-submit").click();
  // My row renders the distilled score once the post lands.
  await expect(
    page.getByTestId(`game-card-${gameId}`).locator('[data-testid^="game-card-score-"]'),
  ).toContainText("Score:");
  return gameId;
}

/** Re-enter Games fresh, then open the per-game board for `host`. */
async function openBoard(page: Page, host: string): Promise<void> {
  await goToGames(page);
  await cardBody(page, host).click();
  await expect(page.getByTestId("game-board")).toBeVisible();
}

/** Re-enter Games fresh and assert a player's score is on the shared card. */
async function expectScoreOnCard(page: Page, userId: string, score: string): Promise<void> {
  await goToGames(page);
  await expect
    .poll(async () => (await page.getByTestId(`game-card-score-${userId}`).count()) > 0, {
      timeout: 10_000,
    })
    .toBe(true);
  await expect(page.getByTestId(`game-card-score-${userId}`)).toContainText(score);
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
