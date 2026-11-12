// Integration tests for nudges (`POST /v1/games/:id/nudges` + the `nudges`
// block on the leaderboard), on PGlite with the real migrations: the rules
// are DB behaviours (friendship, both played, once per friend per game per
// day, the daily allowance, admins unlimited).

import { PGlite } from "@electric-sql/pglite";
import { NUDGE_DAILY_LIMIT } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Never reach Expo from tests.
const { sendExpoPushMessages } = vi.hoisted(() => ({
  sendExpoPushMessages: vi.fn(async (messages: { to: string }[]) => ({
    sent: messages.length,
    failed: 0,
    prunedTokens: [] as string[],
    outcomes: messages.map((m) => ({ to: m.to, status: "ok" as const })),
  })),
}));
vi.mock("../../lib/expoPush.js", () => ({ sendExpoPushMessages }));

import { isNudgeablePeriod } from "../../lib/nudges.js";
import { gameRoutes } from "./games.js";

const uid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const me = uid(1);
const admin = uid(2);
const stranger = uid(3);
const noPush = uid(4);
const notPlayed = uid(5);
const blocked = uid(6);
/** Seven reachable friends who have played: more than the daily allowance. */
const friends = [10, 11, 12, 13, 14, 15, 16].map(uid);
const PERIOD = new Date().toISOString().slice(0, 10);

function authHeaders(asUser: string): Record<string, string> {
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

let gameId: string;
let otherGameId: string;

async function addGame(url: string, asUser: string): Promise<string> {
  const res = await gameRoutes.request("/", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ url }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { game: { id: string } }).game.id;
}

async function postScore(game: string, asUser: string, periodKey = PERIOD) {
  const res = await gameRoutes.request(`/${game}/scores`, {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey, scoreRaw: "Score 3/6" }),
  });
  expect(res.status).toBe(200);
}

function nudge(asUser: string, userId: string, game = gameId, periodKey = PERIOD) {
  return gameRoutes.request(`/${game}/nudges`, {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ userId, periodKey }),
  });
}

async function board(asUser: string, game = gameId, periodKey = PERIOD) {
  const res = await gameRoutes.request(`/${game}/leaderboard?period=${periodKey}`, {
    headers: authHeaders(asUser),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    nudges?: {
      limit: number | null;
      remaining: number | null;
      nudgedUserIds: string[];
      reachableUserIds: string[];
    };
  };
}

async function reason(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { details?: { reason?: string } }).details?.reason;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  const everyone = [me, admin, stranger, noPush, notPlayed, blocked, ...friends];
  for (const [i, id] of everyone.entries()) {
    await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
      id,
      id === admin ? "joshlebed@gmail.com" : `u${i}@example.com`,
      id === me ? "Mia" : `User ${i}`,
    ]);
  }
  // Friends of `me` and of `admin`: everyone but the stranger.
  for (const owner of [me, admin]) {
    for (const other of [noPush, notPlayed, blocked, ...friends]) {
      const [low, high] = owner < other ? [owner, other] : [other, owner];
      await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
    }
  }
  for (const id of [stranger, notPlayed, blocked, ...friends]) {
    await rows(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
       VALUES ($1, $2, 'ios', 'UTC')`,
      [id, `ExponentPushToken[${id.slice(-4)}]`],
    );
  }

  gameId = await addGame("https://example.com/daily-one", me);
  otherGameId = await addGame("https://example.com/daily-two", me);
  for (const id of [stranger, noPush, blocked, ...friends]) await postScore(gameId, id);
  for (const id of friends) await postScore(otherGameId, id);
}, 60_000);

describe("isNudgeablePeriod", () => {
  it("accepts the UTC day give or take one, and nothing else", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(
      ["2026-11-11", "2026-11-12", "2026-11-13"].map((k) => isNudgeablePeriod(k, now)),
    ).toEqual([true, true, true]);
    expect(isNudgeablePeriod("2026-11-10", now)).toBe(false);
    expect(isNudgeablePeriod("2026-11-14", now)).toBe(false);
  });
});

describe("nudges", () => {
  it("offers nothing and refuses before the sender has played", async () => {
    expect((await board(me)).nudges).toBeUndefined();
    const res = await nudge(me, friends[0] as string);
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("not_played");
  });

  it("reports the allowance and who is reachable once the sender has played", async () => {
    await postScore(gameId, me);
    await postScore(otherGameId, me);
    const state = (await board(me)).nudges;
    expect(state?.limit).toBe(NUDGE_DAILY_LIMIT);
    expect(state?.remaining).toBe(NUDGE_DAILY_LIMIT);
    expect(state?.nudgedUserIds).toEqual([]);
    // Friends with a device; `noPush` played but has none; the stranger is not on the board.
    expect([...(state?.reachableUserIds ?? [])].sort()).toEqual([blocked, ...friends].sort());
  });

  it("omits the block on a past day", async () => {
    await postScore(gameId, me, "2020-01-01");
    expect((await board(me, gameId, "2020-01-01")).nudges).toBeUndefined();
    const res = await nudge(me, friends[0] as string, gameId, "2020-01-01");
    expect(res.status).toBe(400);
  });

  it("refuses self, strangers, blocked friends, and friends who can't get one", async () => {
    expect((await nudge(me, me)).status).toBe(400);
    expect((await nudge(me, stranger)).status).toBe(404);

    await rows(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blocked, me]);
    expect((await nudge(me, blocked)).status).toBe(404);

    const unplayed = await nudge(me, notPlayed);
    expect(unplayed.status).toBe(409);
    expect(await reason(unplayed)).toBe("friend_not_played");

    const unreachable = await nudge(me, noPush);
    expect(unreachable.status).toBe(409);
    expect(await reason(unreachable)).toBe("unreachable");
    expect(await rows(`SELECT 1 FROM game_nudges`)).toHaveLength(0);
  });

  it("pushes the friend's devices and counts the nudge", async () => {
    sendExpoPushMessages.mockClear();
    const target = friends[0] as string;
    const res = await nudge(me, target);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      delivered: boolean;
      nudges: { remaining: number | null; nudgedUserIds: string[] };
    };
    expect(body.delivered).toBe(true);
    expect(body.nudges.remaining).toBe(NUDGE_DAILY_LIMIT - 1);
    expect(body.nudges.nudgedUserIds).toEqual([target]);
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
    expect(sendExpoPushMessages.mock.calls[0]?.[0]).toEqual([
      {
        to: `ExponentPushToken[${target.slice(-4)}]`,
        title: "Mia nudged you",
        body: "Mia just played daily-one. See how you stack up.".replace(
          "daily-one",
          ((await rows<{ title: string }>(`SELECT title FROM games WHERE id = $1`, [gameId]))[0]
            ?.title as string) ?? "",
        ),
        data: {
          kind: "nudge",
          userId: me,
          gameId,
          url: `highscore:///games/${gameId}?date=${PERIOD}`,
        },
        sound: "default",
      },
    ]);
  });

  it("allows one nudge per friend per game per day, but another game is separate", async () => {
    sendExpoPushMessages.mockClear();
    const again = await nudge(me, friends[0] as string);
    expect(again.status).toBe(409);
    expect(await reason(again)).toBe("already_nudged");
    expect(sendExpoPushMessages).not.toHaveBeenCalled();

    expect((await nudge(me, friends[0] as string, otherGameId)).status).toBe(201);
    expect((await board(me)).nudges?.remaining).toBe(NUDGE_DAILY_LIMIT - 2);
  });

  it("stops at the daily allowance across games", async () => {
    for (const target of friends.slice(1, 4)) {
      expect((await nudge(me, target)).status).toBe(201);
    }
    expect((await board(me)).nudges?.remaining).toBe(0);

    sendExpoPushMessages.mockClear();
    const over = await nudge(me, friends[4] as string);
    expect(over.status).toBe(429);
    expect(await reason(over)).toBe("daily_limit");
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
    expect(await rows(`SELECT 1 FROM game_nudges WHERE sender_id = $1`, [me])).toHaveLength(
      NUDGE_DAILY_LIMIT,
    );
  });

  it("gives an admin unlimited nudges", async () => {
    await postScore(gameId, admin);
    const before = (await board(admin)).nudges;
    expect(before?.limit).toBeNull();
    expect(before?.remaining).toBeNull();
    for (const target of friends) {
      expect((await nudge(admin, target)).status).toBe(201);
    }
    expect(friends.length).toBeGreaterThan(NUDGE_DAILY_LIMIT);
    const after = (await board(admin)).nudges;
    expect(after?.remaining).toBeNull();
    expect([...(after?.nudgedUserIds ?? [])].sort()).toEqual([...friends].sort());
  });

  it("reports an undelivered push honestly and still counts the nudge", async () => {
    sendExpoPushMessages.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      prunedTokens: [],
      outcomes: [],
    });
    const res = await nudge(admin, friends[0] as string, otherGameId);
    // The admin has not played the other game yet.
    expect(res.status).toBe(409);
    await postScore(otherGameId, admin);
    const sent = await nudge(admin, friends[0] as string, otherGameId);
    expect(sent.status).toBe(201);
    expect(((await sent.json()) as { delivered: boolean }).delivered).toBe(false);
  });
});
