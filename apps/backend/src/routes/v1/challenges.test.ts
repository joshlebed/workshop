// Integration tests for challenge links (`POST /v1/games/:id/challenges`,
// `/v1/challenges/*`). Real SQL against in-memory PGlite with the actual
// drizzle/ migrations: mint idempotency + snapshot refresh, the public vs
// viewer resolve, accept (friendship + game + funnel row, idempotent), expiry
// (resolves, accept 410s), blocks, and the `via` vouch on friend requests.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so the routers' `getDb` resolves to PGlite.
import { CHALLENGE_GRACE_HOURS, challengeExpiresAt, challengeUrl } from "../../lib/challenges.js";
import { todayPeriodKey } from "../../lib/gameShapes.js";
import { challengeRoutes } from "./challenges.js";
import { friendRoutes } from "./friends.js";
import { gameRoutes } from "./games.js";

const app = new Hono();
app.route("/v1/games", gameRoutes);
app.route("/v1/challenges", challengeRoutes);
app.route("/v1/friends", friendRoutes);

const challengerId = "00000000-0000-4000-8000-0000000000c1";
const strangerId = "00000000-0000-4000-8000-0000000000c2";
const friendId = "00000000-0000-4000-8000-0000000000c3";
const blockedId = "00000000-0000-4000-8000-0000000000c4";
const pendingId = "00000000-0000-4000-8000-0000000000c5";
const voucheeId = "00000000-0000-4000-8000-0000000000c6";
const gameId = "00000000-0000-4000-8000-00000000a001";
const timeGameId = "00000000-0000-4000-8000-00000000a002";
const today = todayPeriodKey();

function authHeaders(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function mint(asUser: string, game = gameId, periodKey = today) {
  return app.request(`/v1/games/${game}/challenges`, {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey }),
  });
}

async function mintOk(asUser = challengerId, game = gameId) {
  const res = await mint(asUser, game);
  expect(res.status).toBe(201);
  return (await res.json()) as {
    token: string;
    url: string;
    periodKey: string;
    expiresAt: string;
    score: { value: number | null; summary: string | null; display: string };
  };
}

type Preview = {
  token: string;
  challenger: { userId: string; displayName: string | null };
  game: { id: string; title: string; url: string; scoreUnit: string | null };
  periodKey: string;
  score: { value: number | null; display: string };
  expiresAt: string;
  expired: boolean;
  viewer?: {
    isSelf: boolean;
    isFriend: boolean;
    hasGame: boolean;
    accepted: boolean;
    score: { display: string } | null;
  };
};

async function resolve(token: string, asUser?: string) {
  const res = await app.request(
    `/v1/challenges/${token}`,
    asUser ? { headers: authHeaders(asUser) } : undefined,
  );
  return { status: res.status, body: (await res.json()) as Preview };
}

async function accept(token: string, asUser: string) {
  const res = await app.request(`/v1/challenges/${token}/accept`, {
    method: "POST",
    headers: authHeaders(asUser),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const found = await rows(`SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2`, [
    low,
    high,
  ]);
  return found.length > 0;
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
       ($1, 'challenger@example.com', 'Josh'),
       ($2, 'stranger@example.com', 'Stranger Stan'),
       ($3, 'friend@example.com', 'Friend Fran'),
       ($4, 'blocked@example.com', 'Blocked Bo'),
       ($5, 'pending@example.com', 'Pending Pat'),
       ($6, 'vouchee@example.com', 'Vouchee Val')`,
    [challengerId, strangerId, friendId, blockedId, pendingId, voucheeId],
  );
  await rows(
    `INSERT INTO games (id, normalized_url, url, title) VALUES
       ($1, 'challenge-test.example/maptap', 'https://challenge-test.example/maptap', 'MapTap'),
       ($2, 'example.com/timed', 'https://example.com/timed', 'Timed')`,
    [gameId, timeGameId],
  );
  await rows(`UPDATE games SET score_unit = 'seconds' WHERE id = $1`, [timeGameId]);
  await rows(
    `INSERT INTO user_games (user_id, game_id, position) VALUES ($1, $2, 0), ($1, $3, 1)`,
    [challengerId, gameId, timeGameId],
  );
  await rows(
    `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, score_summary)
     VALUES ($1, $3, $4, 'MapTap 937', 937, '937'),
            ($2, $3, $4, 'Timed 0:42', 42, '0:42')`,
    [gameId, timeGameId, challengerId, today],
  );
  const [low, high] = challengerId < friendId ? [challengerId, friendId] : [friendId, challengerId];
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
  await rows(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
    challengerId,
    blockedId,
  ]);
}, 60_000);

describe("challengeExpiresAt", () => {
  it("is the end of the period's UTC day plus the grace window", () => {
    expect(challengeExpiresAt("2026-11-25").toISOString()).toBe(
      new Date(Date.UTC(2026, 10, 26, CHALLENGE_GRACE_HOURS)).toISOString(),
    );
  });

  it("links to HighScore's /c/:token", () => {
    expect(challengeUrl("AbCd1234", false)).toBe("https://highscore.live/c/AbCd1234");
    expect(challengeUrl("AbCd1234", true)).toBe("http://localhost:8081/c/AbCd1234");
  });
});

describe("POST /v1/games/:id/challenges (mint)", () => {
  it("mints a /c/:token link with the score to beat", async () => {
    const minted = await mintOk();
    expect(minted.token).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(minted.url).toBe(`http://localhost:8081/c/${minted.token}`);
    expect(minted.periodKey).toBe(today);
    expect(minted.score).toEqual({ value: 937, summary: "937", display: "937" });
    expect(minted.expiresAt).toBe(challengeExpiresAt(today).toISOString());
  });

  it("formats a time score the way the board does", async () => {
    const minted = await mintOk(challengerId, timeGameId);
    expect(minted.score.display).toBe("0:42");
  });

  it("reuses the day's token and refreshes the snapshot on re-mint", async () => {
    const first = await mintOk();
    await rows(
      `UPDATE game_scores SET score_value = 951, score_summary = '951'
       WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
      [gameId, challengerId, today],
    );
    const second = await mintOk();
    expect(second.token).toBe(first.token);
    expect(second.score.display).toBe("951");
    const count = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_challenges WHERE challenger_id = $1 AND game_id = $2`,
      [challengerId, gameId],
    );
    expect(count[0]?.n).toBe(1);
    // Back to 937 for the tests below.
    await rows(
      `UPDATE game_scores SET score_value = 937, score_summary = '937'
       WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
      [gameId, challengerId, today],
    );
    await mintOk();
  });

  it("409s when the challenger hasn't posted that day", async () => {
    const res = await mint(strangerId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { details: { code: string } }).details.code).toBe("NO_SCORE");
  });

  it("400s a day that isn't today", async () => {
    const res = await mint(challengerId, gameId, "2020-01-01");
    expect(res.status).toBe(400);
  });

  it("401s without a session", async () => {
    const res = await app.request(`/v1/games/${gameId}/challenges`, {
      method: "POST",
      body: JSON.stringify({ periodKey: today }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/challenges/:token (resolve)", () => {
  it("returns only the public part to an anonymous request (the OG path)", async () => {
    const { token } = await mintOk();
    const { status, body } = await resolve(token);
    expect(status).toBe(200);
    expect(body.challenger).toEqual({ userId: challengerId, displayName: "Josh" });
    expect(body.game).toMatchObject({
      id: gameId,
      title: "MapTap",
      url: "https://challenge-test.example/maptap",
    });
    expect(body.score.display).toBe("937");
    expect(body.expired).toBe(false);
    expect(body.viewer).toBeUndefined();
  });

  it("tells a stranger they're not friends and don't have the game", async () => {
    const { token } = await mintOk();
    const { body } = await resolve(token, strangerId);
    expect(body.viewer).toEqual({
      isSelf: false,
      isFriend: false,
      hasGame: false,
      accepted: false,
      score: null,
    });
  });

  it("recognises the challenger and an existing friend", async () => {
    const { token } = await mintOk();
    expect((await resolve(token, challengerId)).body.viewer).toMatchObject({
      isSelf: true,
      hasGame: true,
      score: { display: "937" },
    });
    expect((await resolve(token, friendId)).body.viewer).toMatchObject({
      isSelf: false,
      isFriend: true,
    });
  });

  it("404s a blocked viewer and an unknown token", async () => {
    const { token } = await mintOk();
    expect((await resolve(token, blockedId)).status).toBe(404);
    expect((await resolve("doesnotexist")).status).toBe(404);
  });
});

describe("POST /v1/challenges/:token/accept", () => {
  it("forms the friendship, adds the game and records the accept", async () => {
    const { token } = await mintOk();
    expect(await areFriends(strangerId, challengerId)).toBe(false);

    const first = await accept(token, strangerId);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      friend: { userId: challengerId, displayName: "Josh" },
      game: { id: gameId, title: "MapTap" },
      periodKey: today,
      friendshipCreated: true,
      gameAdded: true,
    });
    expect(await areFriends(strangerId, challengerId)).toBe(true);
    const owned = await rows(`SELECT 1 FROM user_games WHERE user_id = $1 AND game_id = $2`, [
      strangerId,
      gameId,
    ]);
    expect(owned).toHaveLength(1);

    // Idempotent: a second accept changes nothing and keeps one funnel row.
    const second = await accept(token, strangerId);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ friendshipCreated: false, gameAdded: false });
    const accepts = await rows<{ friendship_created: boolean; game_added: boolean }>(
      `SELECT friendship_created, game_added FROM challenge_accepts WHERE user_id = $1`,
      [strangerId],
    );
    expect(accepts).toEqual([{ friendship_created: true, game_added: true }]);

    const { body } = await resolve(token, strangerId);
    expect(body.viewer).toMatchObject({ isFriend: true, hasGame: true, accepted: true });
  });

  it("consumes a pending request between the pair", async () => {
    const { token } = await mintOk();
    await rows(`INSERT INTO friend_requests (inviter_id, invitee_id) VALUES ($1, $2)`, [
      pendingId,
      challengerId,
    ]);
    expect((await accept(token, pendingId)).status).toBe(201);
    const pending = await rows(
      `SELECT 1 FROM friend_requests WHERE inviter_id = $1 AND invitee_id = $2`,
      [pendingId, challengerId],
    );
    expect(pending).toHaveLength(0);
  });

  it("refuses the challenger's own accept and a blocked user", async () => {
    const { token } = await mintOk();
    expect((await accept(token, challengerId)).status).toBe(400);
    expect((await accept(token, blockedId)).status).toBe(404);
    expect(await areFriends(blockedId, challengerId)).toBe(false);
  });

  it("an expired challenge still resolves, but accept is 410 with the game", async () => {
    const { token } = await mintOk(challengerId, timeGameId);
    await rows(
      `UPDATE game_challenges SET expires_at = now() - interval '1 minute' WHERE token = $1`,
      [token],
    );
    const resolved = await resolve(token);
    expect(resolved.status).toBe(200);
    expect(resolved.body.expired).toBe(true);

    const res = await accept(token, voucheeId);
    expect(res.status).toBe(410);
    expect(res.body.details).toMatchObject({
      code: "CHALLENGE_EXPIRED",
      game: { id: timeGameId, title: "Timed", url: "https://example.com/timed" },
      challenger: { userId: challengerId },
    });
    expect(await areFriends(voucheeId, challengerId)).toBe(false);

    // The token still vouches a plain friend request (the expired landing's
    // "Add Josh"): it forms the friendship at once.
    const req = await app.request("/v1/friends/requests", {
      method: "POST",
      headers: authHeaders(voucheeId),
      body: JSON.stringify({ userId: challengerId, via: token }),
    });
    expect(req.status).toBe(201);
    expect(((await req.json()) as { status: string }).status).toBe("accepted");
    expect(await areFriends(voucheeId, challengerId)).toBe(true);
  });
});
