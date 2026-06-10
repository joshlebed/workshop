// Integration tests for the Games surface (G1a acceptance). Unlike the other
// route suites (schema-only — see views.test.ts), these run the real SQL
// against an in-memory PGlite Postgres with the actual drizzle/ migrations
// applied, because the acceptance criteria are DB behaviors: URL-variant
// dedup, idempotent score upsert, /move reordering, and `item_scores`
// provably untouched.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { normalizeGameUrl } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GAME_REGEX_CATALOG } from "../../lib/gameScoreRegex.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// The add-game path enriches brand-new catalog rows via the link-preview
// pipeline (network). Default to rejecting so tests exercise the fallback
// (hostname title + Google favicon); individual tests override the resolved
// value to assert preview-derived metadata.
const resolveLinkPreviewMock = vi.fn<
  (url: URL) => Promise<{ title: string | null; favicon: string }>
>(() => Promise.reject(new Error("network disabled in tests")));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: (url: URL) => resolveLinkPreviewMock(url),
}));

// Imported after the mock so the router's `getDb` resolves to PGlite.
import { gameRoutes } from "./games.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";

function authHeaders(asUser = userId): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function addGame(url: string, asUser = userId) {
  const res = await gameRoutes.request("/", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ url }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { game: { id: string }; userGame: { position: number | null } };
}

async function myGames(asUser = userId, period?: string) {
  const res = await gameRoutes.request(`/${period ? `?period=${period}` : ""}`, {
    headers: authHeaders(asUser),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    periodKey: string;
    games: {
      gameId: string;
      position: number | null;
      game: { id: string; title: string; gameKey: string | null };
      standings: {
        periodKey: string;
        viewerHasPlayed: boolean;
        entries: { userId: string; scoreValue: number | null; rank: number | null }[];
      };
    }[];
  };
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'games-tester@example.com', 'Games Tester'),
       ($2, 'other@example.com', 'Other User')`,
    [userId, otherUserId],
  );

  // Sentinel rows on the OLD leaderboard surface. The last test asserts they
  // are byte-identical after every games endpoint has been exercised.
  await rows(
    `INSERT INTO lists (id, name, emoji, color, owner_id, modules, share_slug)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'Old games', '🎮', '#fff', $1,
             '{leaderboard}', 'sentinel1')`,
    [userId],
  );
  await rows(
    `INSERT INTO items (id, list_id, title, added_by, kind)
     VALUES ('00000000-0000-4000-8000-00000000000b',
             '00000000-0000-4000-8000-00000000000a', 'Wordle (old)', $1, 'game')`,
    [userId],
  );
  await rows(
    `INSERT INTO item_scores (item_id, user_id, period_key, score_value, score_raw)
     VALUES ('00000000-0000-4000-8000-00000000000b', $1, '2026-06-01', 3, 'Wordle 1,440 3/6')`,
    [userId],
  );
}, 60_000);

describe("migration seed", () => {
  it("seeds one games row per gameScoreRegex catalog entry, keyed by normalizeGameUrl(canonicalUrl)", async () => {
    const seeded = await rows<{
      normalized_url: string;
      url: string;
      title: string;
      icon_url: string | null;
      game_key: string;
      score_direction: string;
    }>(
      `SELECT normalized_url, url, title, icon_url, game_key, score_direction FROM games ORDER BY game_key`,
    );
    expect(seeded.length).toBe(GAME_REGEX_CATALOG.length);
    for (const entry of GAME_REGEX_CATALOG) {
      const row = seeded.find((r) => r.game_key === entry.key);
      expect(row, `catalog entry ${entry.key} missing from migration seed`).toBeDefined();
      expect(row?.normalized_url).toBe(normalizeGameUrl(entry.canonicalUrl));
      expect(row?.url).toBe(entry.canonicalUrl);
      expect(row?.title).toBe(entry.title);
      expect(row?.score_direction).toBe(entry.scoreDirection);
      // Migration 0028 backfills every seeded row with the s2 favicon fallback.
      expect(row?.icon_url).toMatch(/^https:\/\/www\.google\.com\/s2\/favicons\?domain=/);
    }
  });
});

describe("POST /v1/games — find-or-create by normalized URL", () => {
  it("two URL variants of one game resolve to one games row", async () => {
    const a = await addGame("https://www.dailytens.com/");
    const b = await addGame("http://dailytens.com/?ref=abc123");
    expect(b.game.id).toBe(a.game.id);
    const count = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM games WHERE normalized_url = 'dailytens.com'`,
    );
    expect(count[0]?.n).toBe(1);
    const memberships = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_games WHERE user_id = $1 AND game_id = $2`,
      [userId, a.game.id],
    );
    expect(memberships[0]?.n).toBe(1);
  });

  it("a known game pasted under a variant path collapses onto the seeded catalog row", async () => {
    const res = await addGame("https://globle-game.com/game?utm_source=share");
    const seeded = await rows<{ id: string }>(
      `SELECT id FROM games WHERE normalized_url = 'globle-game.com'`,
    );
    expect(res.game.id).toBe(seeded[0]?.id);
  });

  it("an unknown URL gets a hostname title + favicon fallback and dedups on the normalized form", async () => {
    const a = await addGame("https://www.chessle.example.net/play/?day=5");
    const b = await addGame("chessle.example.net/play");
    expect(b.game.id).toBe(a.game.id);
    const row = await rows<{
      title: string;
      icon_url: string | null;
      game_key: string | null;
      url: string;
    }>(`SELECT title, icon_url, game_key, url FROM games WHERE id = $1`, [a.game.id]);
    expect(row[0]?.title).toBe("chessle.example.net");
    expect(row[0]?.icon_url).toBe(
      "https://www.google.com/s2/favicons?domain=chessle.example.net&sz=128",
    );
    expect(row[0]?.game_key).toBeNull();
    expect(row[0]?.url).toBe("https://chessle.example.net/play");
  });

  it("an unknown URL whose link preview resolves gets the page title + favicon", async () => {
    resolveLinkPreviewMock.mockResolvedValueOnce({
      title: "Squardle — The Daily Word-Square Puzzle Everyone Loves",
      favicon: "https://squardle.example.org/apple-touch-icon.png",
    });
    const added = await addGame("https://squardle.example.org/daily");
    const row = await rows<{ title: string; icon_url: string | null }>(
      `SELECT title, icon_url FROM games WHERE id = $1`,
      [added.game.id],
    );
    // Long page titles are distilled to the segment before the separator.
    expect(row[0]?.title).toBe("Squardle");
    expect(row[0]?.icon_url).toBe("https://squardle.example.org/apple-touch-icon.png");
  });

  it("adding an existing game never refetches its preview", async () => {
    resolveLinkPreviewMock.mockClear();
    await addGame("https://framed.wtf/", otherUserId);
    expect(resolveLinkPreviewMock).not.toHaveBeenCalled();
  });

  it("rejects an unusable URL", async () => {
    const res = await gameRoutes.request("/", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url: "not a url" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /v1/games/:id/scores", () => {
  it("parses the score via the catalog regex, upserts idempotently, and auto-adds to My Games", async () => {
    const wordle = await rows<{ id: string }>(`SELECT id FROM games WHERE game_key = 'wordle'`);
    const gameId = wordle[0]?.id as string;

    // otherUser has never added Wordle — posting a score must auto-add it.
    const first = await gameRoutes.request(`/${gameId}/scores`, {
      method: "PUT",
      headers: authHeaders(otherUserId),
      body: JSON.stringify({ periodKey: "2026-06-10", scoreRaw: "Wordle 1,449 3/6\n\n⬛⬛🟩🟩🟩" }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { score: { scoreValue: number | null } };
    expect(firstBody.score.scoreValue).toBe(3);

    const membership = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_games WHERE user_id = $1 AND game_id = $2`,
      [otherUserId, gameId],
    );
    expect(membership[0]?.n).toBe(1);

    // Re-post the same day → updates in place, still one row.
    const second = await gameRoutes.request(`/${gameId}/scores`, {
      method: "PUT",
      headers: authHeaders(otherUserId),
      body: JSON.stringify({ periodKey: "2026-06-10", scoreRaw: "Wordle 1,449 5/6" }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { score: { scoreValue: number | null } };
    expect(secondBody.score.scoreValue).toBe(5);

    const scoreRows = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_scores
       WHERE game_id = $1 AND user_id = $2 AND period_key = '2026-06-10'`,
      [gameId, otherUserId],
    );
    expect(scoreRows[0]?.n).toBe(1);
  });

  it("counts marker emoji for count: catalog entries (Daily Tens)", async () => {
    const dailytens = await rows<{ id: string }>(
      `SELECT id FROM games WHERE game_key = 'dailytens'`,
    );
    const res = await gameRoutes.request(`/${dailytens[0]?.id}/scores`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        periodKey: "2026-06-10",
        scoreRaw: "Daily Tens\n🏆🏆❌🏆🏆\n🏆❌🏆🏆❌\nhttps://dailytens.com/?ref=junk99",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { score: { scoreValue: number | null } };
    expect(body.score.scoreValue).toBe(7);
  });

  it("404s for a game that doesn't exist", async () => {
    const res = await gameRoutes.request("/00000000-0000-4000-8000-0000000000ff/scores", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ periodKey: "2026-06-10", scoreRaw: "x 1" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/games — ordered list + standings block per game", () => {
  it("returns my games in position order with a per-game standings block", async () => {
    const body = await myGames(userId, "2026-06-10");
    expect(body.periodKey).toBe("2026-06-10");
    expect(body.games.length).toBeGreaterThanOrEqual(3);
    // Position order is ascending.
    const positions = body.games.map((g) => g.position);
    const sorted = [...positions].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    expect(positions).toEqual(sorted);

    // The Daily Tens score posted above shows up as a ranked standings entry.
    const dailytens = body.games.find((g) => g.game.gameKey === "dailytens");
    expect(dailytens).toBeDefined();
    expect(dailytens?.standings.periodKey).toBe("2026-06-10");
    expect(dailytens?.standings.viewerHasPlayed).toBe(true);
    expect(dailytens?.standings.entries).toEqual([
      expect.objectContaining({ userId, scoreValue: 7, rank: 1 }),
    ]);

    // Standings are self-only: otherUser's Wordle score is not visible to me.
    const visible = body.games.flatMap((g) => g.standings.entries.map((e) => e.userId));
    expect(visible).not.toContain(otherUserId);

    // An unplayed game has an empty block and no play flag.
    const unplayed = body.games.find((g) => g.game.gameKey === null);
    expect(unplayed?.standings.entries).toEqual([]);
    expect(unplayed?.standings.viewerHasPlayed).toBe(false);
  });

  it("an empty selection returns an empty list", async () => {
    const fresh = "00000000-0000-4000-8000-000000000003";
    await rows(`INSERT INTO users (id, email) VALUES ($1, 'fresh@example.com')`, [fresh]);
    const body = await myGames(fresh);
    expect(body.games).toEqual([]);
  });
});

describe("POST /v1/games/:id/move", () => {
  it("reorders my games and persists across GET", async () => {
    const before = await myGames();
    expect(before.games.length).toBeGreaterThanOrEqual(3);
    const ids = before.games.map((g) => g.gameId);
    const last = ids[ids.length - 1] as string;
    const first = ids[0] as string;

    // Move the last game to the top (just before the current first).
    const res = await gameRoutes.request(`/${last}/move`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ afterGameId: first }),
    });
    expect(res.status).toBe(200);

    const after = await myGames();
    expect(after.games[0]?.gameId).toBe(last);
    expect(after.games.map((g) => g.gameId).slice(1)).toEqual(ids.slice(0, -1));
  });

  it("404s when the game isn't in my list", async () => {
    const wordle = await rows<{ id: string }>(`SELECT id FROM games WHERE game_key = 'wordle'`);
    const res = await gameRoutes.request(`/${wordle[0]?.id}/move`, {
      method: "POST",
      headers: authHeaders(), // wordle is in otherUser's list, not mine
      body: JSON.stringify({ beforeGameId: null, afterGameId: null }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/games/:id/leaderboard", () => {
  it("returns my ranked entry for the period (self-only)", async () => {
    const dailytens = await rows<{ id: string }>(
      `SELECT id FROM games WHERE game_key = 'dailytens'`,
    );
    const res = await gameRoutes.request(`/${dailytens[0]?.id}/leaderboard?period=2026-06-10`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      periodKey: string;
      entries: { userId: string; scoreValue: number | null; rank: number | null }[];
    };
    expect(body.periodKey).toBe("2026-06-10");
    expect(body.entries).toEqual([expect.objectContaining({ userId, scoreValue: 7, rank: 1 })]);
  });

  it("returns empty entries for a period nobody played", async () => {
    const dailytens = await rows<{ id: string }>(
      `SELECT id FROM games WHERE game_key = 'dailytens'`,
    );
    const res = await gameRoutes.request(`/${dailytens[0]?.id}/leaderboard?period=1999-01-01`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });
});

describe("DELETE /v1/games/:id", () => {
  it("removes only my user_games row — catalog row and scores survive", async () => {
    const dailytens = await rows<{ id: string }>(
      `SELECT id FROM games WHERE game_key = 'dailytens'`,
    );
    const gameId = dailytens[0]?.id as string;
    const res = await gameRoutes.request(`/${gameId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const membership = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_games WHERE user_id = $1 AND game_id = $2`,
      [userId, gameId],
    );
    expect(membership[0]?.n).toBe(0);
    const game = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM games WHERE id = $1`, [
      gameId,
    ]);
    expect(game[0]?.n).toBe(1);
    const scores = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_scores WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId],
    );
    expect(scores[0]?.n).toBe(1);
  });
});

describe("requires auth", () => {
  it("401s without a bearer token", async () => {
    const res = await gameRoutes.request("/");
    expect(res.status).toBe(401);
  });
});

describe("item_scores is provably untouched", () => {
  it("the sentinel old-surface rows are byte-identical after exercising every endpoint", async () => {
    const sentinel = await rows(
      `SELECT item_id, user_id, period_key, score_value, score_raw FROM item_scores`,
    );
    expect(sentinel).toEqual([
      {
        item_id: "00000000-0000-4000-8000-00000000000b",
        user_id: userId,
        period_key: "2026-06-01",
        score_value: "3",
        score_raw: "Wordle 1,440 3/6",
      },
    ]);
  });

  it("the games modules never reference the old leaderboard tables", () => {
    for (const file of ["src/routes/v1/games.ts", "src/lib/gamePositions.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("item_scores"), `${file} references item_scores`).toBe(false);
      expect(source.includes("itemScores"), `${file} references itemScores`).toBe(false);
    }
  });
});
