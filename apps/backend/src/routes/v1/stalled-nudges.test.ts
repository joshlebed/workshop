// Spike 4 on PGlite with the real migrations: the score post names the
// friends who haven't played yet (`stalledFriends`), one call nudges them
// (`POST /v1/games/:id/nudges/stalled`) inside the shared daily allowance,
// and a nudged friend's post stamps `answered_at` and tells the sender.

import { PGlite } from "@electric-sql/pglite";
import { NUDGE_DAILY_LIMIT } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Never reach Expo from tests; `failFor` makes one device's ticket fail.
const { sendExpoPushMessages, failFor } = vi.hoisted(() => {
  const failFor = new Set<string>();
  return {
    failFor,
    sendExpoPushMessages: vi.fn(async (messages: { to: string }[]) => {
      const outcomes = messages.map((m) => ({
        to: m.to,
        status: failFor.has(m.to) ? ("request_failed" as const) : ("ok" as const),
      }));
      const sent = outcomes.filter((o) => o.status === "ok").length;
      return { sent, failed: messages.length - sent, prunedTokens: [] as string[], outcomes };
    }),
  };
});
vi.mock("../../lib/expoPush.js", () => ({ sendExpoPushMessages }));

import { gameRoutes } from "./games.js";
import { telemetryRoutes } from "./telemetry.js";

const uid = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const me = uid(1);
const sam = uid(2); // has the game, no score, has a device
const riley = uid(3); // same
const noDevice = uid(4); // has the game, no device
const played = uid(5); // already posted
const noGame = uid(6); // a friend without the game
const stranger = uid(7); // not a friend
const blocker = uid(8); // a friend who blocked me
const extras = [20, 21, 22, 23, 24, 25].map(uid); // more stalled friends than the allowance
const PERIOD = new Date().toISOString().slice(0, 10);
const token = (id: string) => `ExponentPushToken[${id.slice(-4)}]`;

function authHeaders(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
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

interface PostBody {
  stalledFriends?: {
    friends: { userId: string; displayName: string | null }[];
    remaining: number | null;
    limit: number | null;
  };
}

async function postScore(game: string, asUser: string): Promise<PostBody> {
  const res = await gameRoutes.request(`/${game}/scores`, {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey: PERIOD, scoreRaw: "Score 3/6" }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PostBody;
}

async function nudgeStalled(asUser: string, userIds: string[], game = gameId) {
  const res = await gameRoutes.request(`/${game}/nudges/stalled`, {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey: PERIOD, userIds }),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      nudged: string[];
      refused: { userId: string; reason: string }[];
      remaining: number | null;
      limit: number | null;
    },
  };
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  const names: Record<string, string> = { [me]: "Mia", [sam]: "Sam", [riley]: "Riley" };
  const everyone = [me, sam, riley, noDevice, played, noGame, stranger, blocker, ...extras];
  for (const [i, id] of everyone.entries()) {
    await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
      id,
      `s${i}@example.com`,
      names[id] ?? `Zed ${String(i).padStart(2, "0")}`,
    ]);
  }
  for (const other of everyone.filter((id) => id !== me && id !== stranger)) {
    const [low, high] = me < other ? [me, other] : [other, me];
    await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
  }
  // Sam and Riley are friends too, for the "sender hasn't posted" case.
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [
    sam,
    riley, // uid(2) < uid(3): already canonical
  ]);
  await rows(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blocker, me]);
  for (const id of everyone.filter((x) => x !== noDevice)) {
    await rows(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone) VALUES ($1, $2, 'ios', 'UTC')`,
      [id, token(id)],
    );
  }
  gameId = await addGame("https://example.com/stalled-one", me);
  otherGameId = await addGame("https://example.com/stalled-two", me);
  for (const id of everyone.filter((x) => x !== me && x !== noGame)) {
    await rows(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)`, [id, gameId]);
  }
  await postScore(gameId, played);
}, 60_000);

beforeEach(() => {
  sendExpoPushMessages.mockClear();
  failFor.clear();
});

describe("one-tap nudge after posting", () => {
  it("names reachable friends who have the game and haven't posted it", async () => {
    const body = await postScore(gameId, me);
    expect(body.stalledFriends?.limit).toBe(NUDGE_DAILY_LIMIT);
    expect(body.stalledFriends?.remaining).toBe(NUDGE_DAILY_LIMIT);
    const ids = body.stalledFriends?.friends.map((f) => f.userId);
    // Riley, Sam, then the six extras — never the device-less, the played,
    // the game-less, the stranger or the blocker.
    expect(ids).toEqual([riley, sam, ...extras]);
    expect(body.stalledFriends?.friends[0]).toEqual({ userId: riley, displayName: "Riley" });
  });

  it("offers nothing on a game no friend has", async () => {
    expect((await postScore(otherGameId, me)).stalledFriends).toBeUndefined();
  });

  it("judges each friend alone and spends the shared allowance", async () => {
    const { status, body } = await nudgeStalled(me, [
      sam,
      riley,
      noDevice,
      played,
      noGame,
      stranger,
      blocker,
    ]);
    expect(status).toBe(200);
    expect(body.nudged).toEqual([sam, riley]);
    expect(body.refused).toEqual([
      { userId: stranger, reason: "not_found" },
      { userId: blocker, reason: "not_found" },
      { userId: noDevice, reason: "unreachable" },
      { userId: played, reason: "friend_already_played" },
      { userId: noGame, reason: "friend_lacks_game" },
    ]);
    expect(body.remaining).toBe(NUDGE_DAILY_LIMIT - 2);
    const messages = sendExpoPushMessages.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(messages).toEqual([
      expect.objectContaining({
        to: token(sam),
        title: "Mia is waiting for your example.com score",
        body: "They posted today — your turn",
        data: {
          kind: "nudge_waiting",
          userId: me,
          gameId,
          url: `highscore:///games/${gameId}?date=${PERIOD}`,
        },
      }),
      expect.objectContaining({ to: token(riley) }),
    ]);
    expect(
      await rows(
        `SELECT recipient_id, surface FROM game_nudges WHERE sender_id = $1 ORDER BY recipient_id`,
        [me],
      ),
    ).toEqual([
      { recipient_id: sam, surface: "post_notice" },
      { recipient_id: riley, surface: "post_notice" },
    ]);
    // Already nudged: not offered again, and refused if asked.
    const again = await nudgeStalled(me, [sam]);
    expect(again.body.refused).toEqual([{ userId: sam, reason: "already_nudged" }]);
  });

  it("stops at the daily allowance and takes back what Expo refused", async () => {
    failFor.add(token(extras[0] as string));
    const { body } = await nudgeStalled(me, extras);
    // 3 left: extras[0] failed at Expo (taken back), extras[1..2] sent, the rest over the cap.
    expect(body.nudged).toEqual([extras[1], extras[2]]);
    expect(body.refused).toEqual([
      { userId: extras[3], reason: "daily_limit" },
      { userId: extras[4], reason: "daily_limit" },
      { userId: extras[5], reason: "daily_limit" },
      { userId: extras[0], reason: "push_failed" },
    ]);
    expect(body.remaining).toBe(1);
  });

  it("refuses everyone before the sender has posted", async () => {
    const { body } = await nudgeStalled(sam, [riley]);
    expect(body.nudged).toEqual([]);
    expect(body.refused).toEqual([{ userId: riley, reason: "not_played" }]);
  });

  it("stamps the answer and tells the sender when a nudged friend posts", async () => {
    await postScore(gameId, sam);
    const answered = await rows(
      `SELECT answered_at FROM game_nudges WHERE sender_id = $1 AND recipient_id = $2`,
      [me, sam],
    );
    expect(answered[0]?.answered_at).not.toBeNull();
    const call = sendExpoPushMessages.mock.calls.find((c) =>
      (c[0] as { data?: { kind?: string } }[]).some((m) => m.data?.kind === "nudge_answered"),
    );
    expect(call?.[0]).toEqual([
      expect.objectContaining({
        to: token(me),
        title: "Sam posted example.com",
        body: "You nudged them — see how you compare",
        data: expect.objectContaining({ kind: "nudge_answered", userId: sam, gameId }),
      }),
    ]);
    // A re-post doesn't tell the sender twice.
    sendExpoPushMessages.mockClear();
    await postScore(gameId, sam);
    expect(
      sendExpoPushMessages.mock.calls.some((c) =>
        (c[0] as { data?: { kind?: string } }[]).some((m) => m.data?.kind === "nudge_answered"),
      ),
    ).toBe(false);
  });
});

describe("push pre-prompt telemetry", () => {
  it("accepts a trigger + step and rejects unknown ones", async () => {
    const send = (body: unknown) =>
      telemetryRoutes.request("/push-prompt", {
        method: "POST",
        headers: authHeaders(me),
        body: JSON.stringify(body),
      });
    expect((await send({ trigger: "nudge", step: "shown" })).status).toBe(200);
    expect((await send({ trigger: "launch", step: "shown" })).status).toBe(400);
  });
});
