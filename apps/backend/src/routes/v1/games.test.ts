// Integration tests for the Games surface (G1a acceptance). Unlike the other
// route suites (schema-only — see views.test.ts), these run the real SQL
// against an in-memory PGlite Postgres with the actual drizzle/ migrations
// applied, because the acceptance criteria are DB behaviors: URL-variant
// dedup, idempotent score upsert, and /move reordering.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { CATALOG_GAME_DEFINITIONS } from "@workshop/shared/gameRegistry";
import type { GameStandingsEntry } from "@workshop/shared/games";
import { normalizeGameUrl } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
}, 60_000);

describe("migration seed", () => {
  it("seeds one games row per registry catalog entry, keyed by normalizeGameUrl(canonicalUrl)", async () => {
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
    expect(seeded.length).toBe(CATALOG_GAME_DEFINITIONS.length);
    for (const entry of CATALOG_GAME_DEFINITIONS) {
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

  it("keeps user_games.position order after backfill instead of recalculating by play count", async () => {
    const reordered = "00000000-0000-4000-8000-000000000004";
    await rows(`INSERT INTO users (id, email) VALUES ($1, 'reordered@example.com')`, [reordered]);

    const catalog = await rows<{ id: string; game_key: string }>(
      `SELECT id, game_key
       FROM games
       WHERE game_key IN ('wordle', 'globle', 'maptap')`,
    );
    const gameIds = new Map(catalog.map((g) => [g.game_key, g.id]));
    const wordleId = gameIds.get("wordle");
    const globleId = gameIds.get("globle");
    const maptapId = gameIds.get("maptap");
    expect({ wordleId, globleId, maptapId }).toEqual({
      wordleId: expect.any(String),
      globleId: expect.any(String),
      maptapId: expect.any(String),
    });
    const wordle = wordleId as string;
    const globle = globleId as string;
    const maptap = maptapId as string;

    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw, created_at, updated_at)
       VALUES
       ($1, $4, '2026-06-08', 3, 'Wordle 1,447 3/6', '2026-06-08T12:00:00Z', '2026-06-08T12:00:00Z'),
       ($1, $4, '2026-06-09', 4, 'Wordle 1,448 4/6', '2026-06-09T12:00:00Z', '2026-06-09T12:00:00Z'),
       ($1, $4, '2026-06-10', 5, 'Wordle 1,449 5/6', '2026-06-10T12:00:00Z', '2026-06-10T12:00:00Z'),
       ($2, $4, '2026-06-09', 4, '⬜🟨🟩 = 4', '2026-06-09T12:05:00Z', '2026-06-09T12:05:00Z'),
       ($2, $4, '2026-06-10', 5, '⬜🟨🟩 = 5', '2026-06-10T12:05:00Z', '2026-06-10T12:05:00Z'),
       ($3, $4, '2026-06-10', 770, 'Final score: 770', '2026-06-10T12:10:00Z', '2026-06-10T12:10:00Z')`,
      [wordle, globle, maptap, reordered],
    );

    // Simulate a user reorder after the play-count backfill. Play count would
    // put Wordle first, but stored positions put MapTap first.
    await rows(
      `INSERT INTO user_games (user_id, game_id, position, added_at)
       VALUES
       ($1, $2, 1024, '2026-06-10T12:10:00Z'),
       ($1, $3, 2048, '2026-06-09T12:05:00Z'),
       ($1, $4, 3072, '2026-06-08T12:00:00Z')`,
      [reordered, maptap, globle, wordle],
    );

    const before = await myGames(reordered, "2026-06-10");
    expect(before.games.map((g) => g.game.gameKey)).toEqual(["maptap", "globle", "wordle"]);

    const postMoreWordle = await gameRoutes.request(`/${wordle}/scores`, {
      method: "PUT",
      headers: authHeaders(reordered),
      body: JSON.stringify({
        periodKey: "2026-06-11",
        scoreRaw: "Wordle 1,450 2/6",
      }),
    });
    expect(postMoreWordle.status).toBe(200);

    const after = await myGames(reordered, "2026-06-11");
    expect(after.games.map((g) => g.game.gameKey)).toEqual(["maptap", "globle", "wordle"]);
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

describe("GET /v1/games/discovery — friend's games + friendGameCount", () => {
  // user_low < user_high so the inserted friendship row is canonical.
  const viewer = "00000000-0000-4000-8000-0000000000d1";
  const friendWithGames = "00000000-0000-4000-8000-0000000000d2";
  const friendNoGames = "00000000-0000-4000-8000-0000000000d3";

  async function discover(asUser: string, friendId: string) {
    const res = await gameRoutes.request(`/discovery?friend=${friendId}`, {
      headers: authHeaders(asUser),
    });
    return res;
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [viewer, "viewer@example.com"],
      [friendWithGames, "fwg@example.com"],
      [friendNoGames, "fng@example.com"],
    ]) {
      await rows(`INSERT INTO users (id, email) VALUES ($1, $2)`, [id, email]);
    }
    await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2), ($1, $3)`, [
      viewer,
      friendWithGames,
      friendNoGames,
    ]);
    // The friend plays two games; the viewer already plays one of them.
    await addGame("https://www.nytimes.com/games/wordle/index.html", friendWithGames);
    await addGame("https://globle-game.com", friendWithGames);
    await addGame("https://www.nytimes.com/games/wordle/index.html", viewer);
  });

  it("reports games the viewer lacks plus the friend's total game count", async () => {
    const res = await discover(viewer, friendWithGames);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: { game: { gameKey: string | null } }[];
      friendGameCount?: number;
    };
    // Only Globle is new to the viewer (they already have Wordle)...
    expect(body.games.map((g) => g.game.gameKey)).toEqual(["globle"]);
    // ...but the count reflects the friend's full library, not the filtered list.
    expect(body.friendGameCount).toBe(2);
  });

  it("distinguishes 'all already added' (count > 0) from 'no games' (count 0)", async () => {
    // Viewer adds the friend's remaining game → discovery is now empty, but the
    // friend still has games, so friendGameCount stays > 0 (the bug: the UI
    // must not say "hasn't added any games yet" here).
    await addGame("https://globle-game.com", viewer);
    const caughtUp = await discover(viewer, friendWithGames);
    const caughtUpBody = (await caughtUp.json()) as {
      games: unknown[];
      friendGameCount?: number;
    };
    expect(caughtUpBody.games).toEqual([]);
    expect(caughtUpBody.friendGameCount).toBe(2);

    // A friend with no games at all reports an empty list and a zero count.
    const empty = await discover(viewer, friendNoGames);
    const emptyBody = (await empty.json()) as { games: unknown[]; friendGameCount?: number };
    expect(emptyBody.games).toEqual([]);
    expect(emptyBody.friendGameCount).toBe(0);
  });

  it("omits friendGameCount for the all-friends feed", async () => {
    const res = await gameRoutes.request("/discovery", { headers: authHeaders(viewer) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { friendGameCount?: number };
    expect(body.friendGameCount).toBeUndefined();
  });

  it("404s for a non-friend (can't probe a stranger's games)", async () => {
    const res = await discover(viewer, otherUserId);
    expect(res.status).toBe(404);
  });
});

describe("PUT/DELETE /v1/games/:id/reactions — emoji reactions on a friend's score", () => {
  const viewer = "00000000-0000-4000-8000-0000000000c1";
  const friendA = "00000000-0000-4000-8000-0000000000c2";
  const stranger = "00000000-0000-4000-8000-0000000000c3";
  const mutual = "00000000-0000-4000-8000-0000000000c4"; // friend of both viewer + friendA
  const outsider = "00000000-0000-4000-8000-0000000000c5"; // friend of friendA only
  const period = "2026-06-15";
  let globleId: string;

  async function friend(a: string, b: string) {
    const [low, high] = a < b ? [a, b] : [b, a];
    await rows(
      `INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [low, high],
    );
  }
  function react(asUser: string, scoreUserId: string, emoji: string, p = period) {
    return gameRoutes.request(`/${globleId}/reactions/${p}/${scoreUserId}`, {
      method: "PUT",
      headers: authHeaders(asUser),
      body: JSON.stringify({ emoji }),
    });
  }
  function unreact(asUser: string, scoreUserId: string, p = period) {
    return gameRoutes.request(`/${globleId}/reactions/${p}/${scoreUserId}`, {
      method: "DELETE",
      headers: authHeaders(asUser),
    });
  }
  async function leaderboardEntry(asUser: string, scoreUserId: string) {
    const res = await gameRoutes.request(`/${globleId}/leaderboard?period=${period}`, {
      headers: authHeaders(asUser),
    });
    const body = (await res.json()) as { entries: GameStandingsEntry[] };
    return body.entries.find((e) => e.userId === scoreUserId);
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [viewer, "rx-viewer@example.com"],
      [friendA, "rx-frienda@example.com"],
      [stranger, "rx-stranger@example.com"],
      [mutual, "rx-mutual@example.com"],
      [outsider, "rx-outsider@example.com"],
    ]) {
      await rows(`INSERT INTO users (id, email) VALUES ($1, $2)`, [id, email]);
    }
    await friend(viewer, friendA);
    await friend(viewer, mutual);
    await friend(friendA, mutual);
    await friend(friendA, outsider); // NOT a friend of viewer

    const globle = await rows<{ id: string }>(`SELECT id FROM games WHERE game_key = 'globle'`);
    globleId = globle[0]?.id as string;
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw)
       VALUES ($1, $2, $5, 3, 'viewer'), ($1, $3, $5, 4, 'friendA'), ($1, $4, $5, 5, 'stranger')`,
      [globleId, viewer, friendA, stranger, period],
    );
  });

  it("lets a friend react and echoes the score's reactions back", async () => {
    const res = await react(viewer, friendA, "👍");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reactions: GameStandingsEntry["reactions"] };
    expect(body.reactions).toEqual([
      expect.objectContaining({ emoji: "👍", count: 1, viewerReacted: true }),
    ]);
    expect(body.reactions[0]?.reactors).toEqual([expect.objectContaining({ userId: viewer })]);
  });

  it("replaces the reactor's prior emoji (tapback: one per reactor)", async () => {
    const res = await react(viewer, friendA, "🔥");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reactions: GameStandingsEntry["reactions"] };
    expect(body.reactions).toEqual([
      expect.objectContaining({ emoji: "🔥", count: 1, viewerReacted: true }),
    ]);
    const dbRows = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_score_reactions
       WHERE game_id = $1 AND period_key = $2 AND score_user_id = $3 AND reactor_user_id = $4`,
      [globleId, period, friendA, viewer],
    );
    expect(dbRows[0]?.n).toBe(1);
  });

  it("rejects reacting to your own score", async () => {
    const res = await react(viewer, viewer, "👍");
    expect(res.status).toBe(400);
  });

  it("404s reacting to a non-friend's score (can't probe a stranger)", async () => {
    const res = await react(viewer, stranger, "👍");
    expect(res.status).toBe(404);
    const leaked = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_score_reactions WHERE score_user_id = $1`,
      [stranger],
    );
    expect(leaked[0]?.n).toBe(0);
  });

  it("404s reacting when the friend has no score that day", async () => {
    const res = await react(viewer, friendA, "👍", "2026-06-16");
    expect(res.status).toBe(404);
  });

  it("rejects a non-emoji reaction body", async () => {
    const res = await react(viewer, friendA, "lol");
    expect(res.status).toBe(400);
  });

  it("aggregates by emoji and hides reactors outside the viewer's friend graph", async () => {
    await react(mutual, friendA, "🔥"); // mutual friend — visible, same emoji as viewer
    const outsiderRes = await react(outsider, friendA, "😮"); // friendA's friend, not viewer's
    expect(outsiderRes.status).toBe(200);

    const entry = await leaderboardEntry(viewer, friendA);
    expect(entry?.reactions).toEqual([
      expect.objectContaining({ emoji: "🔥", count: 2, viewerReacted: true }),
    ]);
    const reactorIds = entry?.reactions[0]?.reactors.map((r) => r.userId) ?? [];
    expect(new Set(reactorIds)).toEqual(new Set([viewer, mutual]));
    // The outsider's 😮 exists in the DB but never reaches the viewer.
    const all = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_score_reactions WHERE score_user_id = $1 AND emoji = '😮'`,
      [friendA],
    );
    expect(all[0]?.n).toBe(1);

    // The outsider, however, DOES see their own 😮 on friendA's score.
    const outsiderView = await leaderboardEntry(outsider, friendA);
    const outsiderEmojis = outsiderView?.reactions.map((r) => r.emoji) ?? [];
    expect(outsiderEmojis).toContain("😮");
  });

  it("shows a friend's reaction on the viewer's own score (viewerReacted false)", async () => {
    await react(friendA, viewer, "🎉");
    const myEntry = await leaderboardEntry(viewer, viewer);
    expect(myEntry?.reactions).toEqual([
      expect.objectContaining({ emoji: "🎉", count: 1, viewerReacted: false }),
    ]);
  });

  it("clears only the caller's reaction on DELETE", async () => {
    const res = await unreact(viewer, friendA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reactions: GameStandingsEntry["reactions"] };
    // The mutual friend's 🔥 stays; the viewer's is gone.
    expect(body.reactions).toEqual([
      expect.objectContaining({ emoji: "🔥", count: 1, viewerReacted: false }),
    ]);
    const mine = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_score_reactions
       WHERE score_user_id = $1 AND reactor_user_id = $2`,
      [friendA, viewer],
    );
    expect(mine[0]?.n).toBe(0);
  });
});

describe("GET /v1/games/discovery?includeOwned — full ranked friend feed", () => {
  // user_low < user_high keeps each inserted friendship row canonical.
  const v = "00000000-0000-4000-8000-0000000000e1";
  const f1 = "00000000-0000-4000-8000-0000000000e2";
  const f2 = "00000000-0000-4000-8000-0000000000e3";
  // Arbitrary unknown hosts → fresh catalog rows that can't collide with the
  // registry-game fixtures above (same global row when added by several users).
  const alphaUrl = "https://e2e-disc-alpha.example.com";
  const betaUrl = "https://e2e-disc-beta.example.com";
  let alphaId = "";
  let betaId = "";

  beforeAll(async () => {
    for (const [id, email] of [
      [v, "disc-v@example.com"],
      [f1, "disc-f1@example.com"],
      [f2, "disc-f2@example.com"],
    ]) {
      await rows(`INSERT INTO users (id, email) VALUES ($1, $2)`, [id, email]);
    }
    await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2), ($1, $3)`, [
      v,
      f1,
      f2,
    ]);
    // f1 plays alpha + beta; f2 plays alpha; the viewer already owns alpha.
    alphaId = (await addGame(alphaUrl, f1)).game.id;
    betaId = (await addGame(betaUrl, f1)).game.id;
    await addGame(alphaUrl, f2);
    await addGame(alphaUrl, v);
  });

  it("keeps owned games, tags inMyGames, and sorts owned after addable", async () => {
    const res = await gameRoutes.request("/discovery?includeOwned=1", {
      headers: authHeaders(v),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: { game: { id: string }; friends: unknown[]; inMyGames: boolean }[];
    };
    // beta (1 friend, addable) sorts above alpha (2 friends, already owned) —
    // owned games sink to the bottom regardless of popularity.
    expect(
      body.games.map((g) => ({
        id: g.game.id,
        friends: g.friends.length,
        inMyGames: g.inMyGames,
      })),
    ).toEqual([
      { id: betaId, friends: 1, inMyGames: false },
      { id: alphaId, friends: 2, inMyGames: true },
    ]);
  });

  it("accepts includeOwned=true as well as =1", async () => {
    const res = await gameRoutes.request("/discovery?includeOwned=true", {
      headers: authHeaders(v),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: { game: { id: string } }[] };
    expect(body.games.map((g) => g.game.id)).toEqual([betaId, alphaId]);
  });

  it("default feed (no includeOwned) still drops owned games, inMyGames false", async () => {
    const res = await gameRoutes.request("/discovery", { headers: authHeaders(v) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: { game: { id: string }; inMyGames: boolean }[];
    };
    // alpha is owned → filtered out; only beta remains, untagged.
    expect(body.games.map((g) => g.game.id)).toEqual([betaId]);
    expect(body.games[0]?.inMyGames).toBe(false);
  });
});

describe("PUT /v1/games/:id/score-spec — the teach flow", () => {
  const exampleRaw = "Squardle #512\nStreak: 14 🔥\n🟩🟩🟨⬜⬜\n🟩🟩🟩🟩🟩\n3/6";
  const teachBody = {
    spec: { rules: [{ kind: "capture", pattern: "(\\d+)\\s*\\/\\s*6\\b" }] },
    exampleRaw,
    expectedValue: 3,
    scoreDirection: "asc" as const,
  };

  async function teach(gameId: string, body: unknown) {
    return gameRoutes.request(`/${gameId}/score-spec`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  }

  it("stores the parser + summary spec and returns both on the game shape", async () => {
    const { game } = await addGame("https://squardle.example.com");
    const summarySpec = {
      rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }],
    };
    const res = await teach(game.id, { ...teachBody, summarySpec });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      game: { scoreSpec: unknown; summarySpec: unknown; scoreDirection: string };
    };
    expect(body.game.scoreSpec).toEqual(teachBody.spec);
    expect(body.game.summarySpec).toEqual(summarySpec);
    expect(body.game.scoreDirection).toBe("asc");
  });

  it("rejects a summary spec that renders the teaching example to nothing", async () => {
    const { game } = await addGame("https://squardle2.example.com");
    const res = await teach(game.id, {
      ...teachBody,
      summarySpec: { rules: [{ kind: "matchLines", pattern: "^never matches$" }] },
    });
    expect(res.status).toBe(400);
    const stored = await rows<{ summary_spec: unknown }>(
      `SELECT summary_spec FROM games WHERE id = $1`,
      [game.id],
    );
    expect(stored[0]?.summary_spec).toBeNull();
  });

  it("re-teaching without a summary spec clears the previously taught one", async () => {
    const { game } = await addGame("https://squardle3.example.com");
    const withSummary = await teach(game.id, {
      ...teachBody,
      summarySpec: { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] },
    });
    expect(withSummary.status).toBe(200);
    const res = await teach(game.id, teachBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { game: { summarySpec: unknown } };
    expect(body.game.summarySpec).toBeNull();
  });

  it("rejects teaching a registry game", async () => {
    const seeded = await rows<{ id: string }>(`SELECT id FROM games WHERE game_key = 'wordle'`);
    const res = await teach(seeded[0]!.id, teachBody);
    expect(res.status).toBe(400);
  });

  it("rejects a spec that doesn't reproduce the expected score on the example", async () => {
    const { game } = await addGame("https://squardle4.example.com");
    const res = await teach(game.id, { ...teachBody, expectedValue: 99 });
    expect(res.status).toBe(400);
  });

  it("audits every successful teach in game_spec_revisions (who, what, from which example)", async () => {
    const { game } = await addGame("https://squardle5.example.com");
    const summarySpec = { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] };
    expect((await teach(game.id, { ...teachBody, summarySpec })).status).toBe(200);
    expect((await teach(game.id, { ...teachBody, scoreDirection: "desc" })).status).toBe(200);

    const revisions = await rows<{
      taught_by: string;
      score_spec: unknown;
      score_direction: string;
      summary_spec: unknown;
      example_raw: string;
    }>(
      `SELECT taught_by, score_spec, score_direction, summary_spec, example_raw
       FROM game_spec_revisions WHERE game_id = $1 ORDER BY created_at`,
      [game.id],
    );
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toEqual({
      taught_by: userId,
      score_spec: teachBody.spec,
      score_direction: "asc",
      summary_spec: summarySpec,
      example_raw: exampleRaw,
    });
    // The re-teach appends (never rewrites) and records its own values — the
    // first revision stays intact as the revert target.
    expect(revisions[1]).toMatchObject({
      taught_by: userId,
      score_direction: "desc",
      summary_spec: null,
    });
  });

  it("writes no revision row for a rejected teach", async () => {
    const { game } = await addGame("https://squardle6.example.com");
    expect((await teach(game.id, { ...teachBody, expectedValue: 99 })).status).toBe(400);
    const revisions = await rows(`SELECT id FROM game_spec_revisions WHERE game_id = $1`, [
      game.id,
    ]);
    expect(revisions).toHaveLength(0);
  });
});

describe("requires auth", () => {
  it("401s without a bearer token", async () => {
    const res = await gameRoutes.request("/");
    expect(res.status).toBe(401);
  });
});

describe("the dropped item_scores table stays gone", () => {
  // item_scores was dropped (migration 0038) after the Lists-side leaderboard
  // surface was retired. Guard against any code path resurrecting a reference
  // to it — a reference would now fail at runtime against a table that no
  // longer exists.
  it("the games modules never reference the old leaderboard tables", () => {
    for (const file of ["src/routes/v1/games.ts", "src/lib/gamePositions.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("item_scores"), `${file} references item_scores`).toBe(false);
      expect(source.includes("itemScores"), `${file} references itemScores`).toBe(false);
    }
  });
});
