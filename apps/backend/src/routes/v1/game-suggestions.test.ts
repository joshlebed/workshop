// GET /v1/games/suggestions + POST /v1/games/suggestions/events (spike 5) —
// real SQL against PGlite with the drizzle/ migrations applied, because the
// ranking, the content gate and the block rule are all query behaviour.

import { PGlite } from "@electric-sql/pglite";
import type { GameSuggestionsResponse } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { gameRoutes } from "./games.js";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// People. V = viewer; F = V's friend; S1..S4 strangers; BL = blocked by V;
// X = F's friend (V's friend-of-friend); W = a viewer with no games whose only
// friend is F; L = a loner (no friends, no games).
const V = id(1);
const F = id(2);
const S1 = id(11);
const S2 = id(12);
const S3 = id(13);
const S4 = id(14);
const BL = id(20);
const X = id(30);
const W = id(40);
const L = id(50);

// Unlisted (user-added) games.
const UNLISTED_STRANGERS = id(901); // only strangers play it → never suggested
const UNLISTED_FRIEND = id(902); // a friend plays it → suggestable
const UNLISTED_FOF = id(903); // only a friend-of-friend posts to it

let listed: { id: string; title: string }[] = [];

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function own(userId: string, ...gameIds: string[]) {
  for (const g of gameIds) {
    await rows(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)`, [userId, g]);
  }
}

async function befriend(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a];
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
}

async function suggestions(asUser: string, query = "") {
  const res = await gameRoutes.request(`/suggestions${query}`, {
    headers: { Authorization: `Bearer ${signSession(asUser)}` },
  });
  return res;
}

async function suggestionList(asUser: string, query = "") {
  const res = await suggestions(asUser, query);
  expect(res.status).toBe(200);
  return ((await res.json()) as GameSuggestionsResponse).suggestions;
}

/** Listed game by index, for readability. */
const g = (i: number) => {
  const game = listed[i];
  if (!game) throw new Error(`no listed game ${i}`);
  return game;
};

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  for (const [userId, name] of [
    [V, "Viewer"],
    [F, "Friend"],
    [S1, "S1"],
    [S2, "S2"],
    [S3, "S3"],
    [S4, "S4"],
    [BL, "Blocked"],
    [X, "Fof"],
    [W, "New"],
    [L, "Loner"],
  ] as const) {
    await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
      userId,
      `${name.toLowerCase()}@example.com`,
      name,
    ]);
  }
  // Seeded registry games are all officially listed.
  listed = await rows<{ id: string; title: string }>(
    `SELECT id, title FROM games WHERE game_key IS NOT NULL ORDER BY title LIMIT 8`,
  );
  expect(listed.length).toBe(8);
  await rows(
    `INSERT INTO games (id, normalized_url, url, title) VALUES
       ($1, 'strangers.example', 'https://strangers.example', 'Strangers Only'),
       ($2, 'friendgame.example', 'https://friendgame.example', 'Friend Game'),
       ($3, 'fofgame.example', 'https://fofgame.example', 'Fof Game')`,
    [UNLISTED_STRANGERS, UNLISTED_FRIEND, UNLISTED_FOF],
  );

  await befriend(V, F);
  await befriend(W, F);
  await befriend(F, X);
  await rows(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [V, BL]);

  // V plays g0 and g1.
  await own(V, g(0).id, g(1).id);
  // Co-players of V's games.
  await own(S1, g(0).id, g(2).id, g(3).id, g(4).id, UNLISTED_STRANGERS);
  await own(S2, g(0).id, g(2).id, g(3).id, UNLISTED_STRANGERS);
  await own(S3, g(1).id, g(2).id, UNLISTED_STRANGERS);
  await own(S4, g(1).id, UNLISTED_STRANGERS);
  await own(F, g(0).id, g(3).id, UNLISTED_FRIEND);
  // BL shares g0 and plays g5 — g5 must not count BL's vote.
  await own(BL, g(0).id, g(5).id);
  await own(S1, g(5).id);
}, 60_000);

describe("GET /v1/games/suggestions — co-play", () => {
  it("ranks games co-added by players of my games, friends counted double", async () => {
    const list = await suggestionList(V);
    const coplay = list.filter((s) => s.reason.kind === "coplay");
    // g3: S1, S2, F → 1 + 1 + 2 = 4. g2: S1, S2, S3 → 3. Same players (3),
    // the friend lifts g3 above g2.
    expect(coplay.map((s) => s.game.id).slice(0, 2)).toEqual([g(3).id, g(2).id]);
    expect(coplay[0]?.reason).toEqual({ kind: "coplay", withGameTitle: g(0).title, players: 3 });
    // g2's co-players: S1, S2 via g0 and S3 via g1 → g0 shares the most.
    expect(coplay[1]?.reason).toEqual({ kind: "coplay", withGameTitle: g(0).title, players: 3 });
  });

  it("never suggests my own games", async () => {
    const ids = (await suggestionList(V)).map((s) => s.game.id);
    expect(ids).not.toContain(g(0).id);
    expect(ids).not.toContain(g(1).id);
  });

  it("gates on the catalog: an unlisted game only strangers play never appears", async () => {
    const ids = (await suggestionList(V)).map((s) => s.game.id);
    // Four strangers co-play it — the strongest stranger signal — and it is
    // still excluded.
    expect(ids).not.toContain(UNLISTED_STRANGERS);
  });

  it("an unlisted game a friend plays may be suggested", async () => {
    const list = await suggestionList(V);
    const row = list.find((s) => s.game.id === UNLISTED_FRIEND);
    expect(row?.reason).toEqual({ kind: "coplay", withGameTitle: g(0).title, players: 1 });
  });

  it("ignores blocked users: their vote does not count toward support", async () => {
    // g4 has one co-player (S1) and no friend → below support; g5 has S1 and
    // BL, but BL is blocked, so it is also one → not a co-play row.
    const list = await suggestionList(V);
    const coplayIds = list.filter((s) => s.reason.kind === "coplay").map((s) => s.game.id);
    expect(coplayIds).not.toContain(g(4).id);
    expect(coplayIds).not.toContain(g(5).id);
  });

  it("fills the rest with the catalog's most played, without repeats", async () => {
    const list = await suggestionList(V);
    expect(list.length).toBe(8);
    const ids = list.map((s) => s.game.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = list.map((s) => s.reason.kind);
    // Tiers in order: co-play rows first, then popular.
    expect(kinds.indexOf("popular")).toBeGreaterThan(kinds.lastIndexOf("coplay"));
    expect(kinds).not.toContain("friends_of_friends"); // V has 2 games
  });

  it("honours ?limit and rejects a bad one", async () => {
    expect((await suggestionList(V, "?limit=2")).length).toBe(2);
    expect((await suggestions(V, "?limit=0")).status).toBe(400);
    expect((await suggestions(V, "?limit=99")).status).toBe(400);
    expect((await suggestions(V, "?limit=abc")).status).toBe(400);
  });
});

describe("GET /v1/games/suggestions — fallbacks", () => {
  it("a 0-game viewer gets friends-of-friends' games of this week, then popular", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // X (W's friend-of-friend) posted to g6 this week and to g7 a month ago,
    // and to an unlisted game nobody W knows directly plays.
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, created_at) VALUES
         ($1, $4, $5, 'raw', now()),
         ($2, $4, '2026-01-01', 'raw', now() - interval '30 days'),
         ($3, $4, $5, 'raw', now())`,
      [g(6).id, g(7).id, UNLISTED_FOF, X, today],
    );
    const list = await suggestionList(W);
    expect(list[0]).toMatchObject({
      game: { id: g(6).id },
      reason: { kind: "friends_of_friends", players: 1 },
    });
    const fofIds = list.filter((s) => s.reason.kind === "friends_of_friends").map((s) => s.game.id);
    expect(fofIds).not.toContain(g(7).id); // older than a week
    expect(list.map((s) => s.game.id)).not.toContain(UNLISTED_FOF); // content gate
    expect(list.slice(1).every((s) => s.reason.kind === "popular")).toBe(true);
  });

  it("a viewer with no friends and no games gets the catalog's most played", async () => {
    const list = await suggestionList(L);
    expect(list.length).toBe(8);
    expect(list.every((s) => s.reason.kind === "popular")).toBe(true);
    // g0 has the most players (V, S1, S2, F, BL) among the listed games.
    expect(list[0]?.game.id).toBe(g(0).id);
  });
});

describe("POST /v1/games/suggestions/events", () => {
  async function post(body: unknown) {
    return gameRoutes.request("/suggestions/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signSession(V)}`,
        "Content-Type": "application/json",
        "X-Workshop-Platform": "web",
      },
      body: JSON.stringify(body),
    });
  }

  it("records impressions and adds by surface and reason, dropping unknown games", async () => {
    const res = await post({
      surface: "board",
      events: [
        { event: "impression", gameId: g(3).id, reasonKind: "coplay", rank: 0 },
        { event: "add", gameId: g(3).id, reasonKind: "coplay", rank: 0 },
        { event: "impression", gameId: id(999), reasonKind: "popular" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 2 });
    const stored = await rows<{ event: string; surface: string; reason_kind: string }>(
      `SELECT event, surface, reason_kind FROM game_suggestion_events WHERE user_id = $1 ORDER BY event`,
      [V],
    );
    expect(stored).toEqual([
      { event: "add", surface: "board", reason_kind: "coplay" },
      { event: "impression", surface: "board", reason_kind: "coplay" },
    ]);
  });

  it("rejects an unknown surface or event", async () => {
    expect(
      (
        await post({
          surface: "nowhere",
          events: [{ event: "impression", gameId: g(3).id, reasonKind: "coplay" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          surface: "home",
          events: [{ event: "click", gameId: g(3).id, reasonKind: "coplay" }],
        })
      ).status,
    ).toBe(400);
  });
});
