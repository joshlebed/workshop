// Spike #10 against PGlite with the real migrations: pair streaks on
// `GET /v1/friends` and the profile, weekly quests (generation, targets, caps,
// completion + push once, celebration ack) and the keep-alive instrumentation.

import { PGlite } from "@electric-sql/pglite";
import type {
  FriendProfileResponse,
  FriendQuestsResponse,
  FriendsResponse,
} from "@workshop/shared/friends";
import { computeFriendStreak, shiftPeriodKey } from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
const sendExpoPushMessages = vi.fn(async (messages: unknown[]) => ({
  sent: messages.length,
  failed: 0,
  prunedTokens: [],
}));
vi.mock("../../lib/expoPush.js", () => ({
  sendExpoPushMessages: (messages: unknown[]) => sendExpoPushMessages(messages),
}));

import { buildQuestCompletePushMessages, pickQuestPartners } from "../../lib/friendQuests.js";
import { loadFriendStreaks, recordKeepalivePost } from "../../lib/friendStreaks.js";
import { friendRoutes } from "./friends.js";

const id = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const me = id(1);
const sam = id(2); // 3-day streak, posted today
const riley = id(3); // 4-day streak through yesterday, not today
const quinn = id(4); // streak broken by a gap
const casey = id(5); // friend, never posted
const stranger = id(6); // not a friend, plays every day
const busy = [id(10), id(11), id(12), id(13), id(14), id(15)]; // friends of `riley` only
const extra = [id(20), id(21), id(22), id(23)]; // more active friends of mine
const game = "00000000-0000-4000-8000-0000000003f1";
const game2 = "00000000-0000-4000-8000-0000000003f2";

// Wednesday. The ISO week is 2026-06-29 … 2026-07-05.
const TODAY = "2026-07-01";
const WEEK = "2026-06-29";
const day = (delta: number) => shiftPeriodKey(TODAY, delta);

async function sql(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return client.query(query, params);
}

async function score(userId: string, periodKey: string, gameId = game) {
  await sql(
    `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw, parse_status)
     VALUES ($1, $2, $3, 1, 'raw', 'score') ON CONFLICT DO NOTHING`,
    [gameId, userId, periodKey],
  );
}

async function friends(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a];
  await sql(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
}

function get(asUser: string, path: string) {
  return friendRoutes.request(path, {
    headers: { Authorization: `Bearer ${signSession(asUser)}` },
  });
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  const everyone = [me, sam, riley, quinn, casey, stranger, ...busy, ...extra];
  for (const [i, u] of everyone.entries()) {
    await sql(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
      u,
      `streak-${i}@example.com`,
      `User ${i}`,
    ]);
  }
  await sql(`UPDATE users SET display_name = 'Sam' WHERE id = $1`, [sam]);
  await sql(`UPDATE users SET display_name = 'Riley' WHERE id = $1`, [riley]);
  await sql(
    `INSERT INTO games (id, normalized_url, url, title) VALUES
       ($1, 'streak.example', 'https://streak.example', 'Streak'),
       ($2, 'streak2.example', 'https://streak2.example', 'Streak 2')`,
    [game, game2],
  );
  for (const f of [sam, riley, quinn, casey, ...extra]) await friends(me, f);
  for (const b of busy) await friends(riley, b);

  // Me: every day for 10 days except today (so I'm the one at risk today).
  for (let d = -10; d <= -1; d++) await score(me, day(d));
  // A day after my today (another timezone) never counts.
  await score(sam, day(1));
  // Sam: -3 … today → shared run -3 … -1 = 3 (I haven't posted today).
  for (const d of [-3, -2, -1, 0]) await score(sam, day(d));
  // Riley: -4..-1, a second game on -1 (one day still counts once).
  for (const d of [-4, -3, -2, -1]) await score(riley, day(d));
  await score(riley, day(-1), game2);
  // Quinn: -6, -5, then a gap, then -1 → shared run is just -1.
  for (const d of [-6, -5, -1]) await score(quinn, day(d));
  // The stranger plays every day but isn't a friend.
  for (let d = -10; d <= 0; d++) await score(stranger, day(d));
  // Riley's five busy friends all played recently.
  for (const b of busy) await score(b, day(-1));
  // My other active friends, older activity (pair recency sorts them after).
  for (const [i, e] of extra.entries()) await score(e, day(-5 - i));
}, 60_000);

beforeEach(() => {
  sendExpoPushMessages.mockClear();
});

describe("GET /v1/friends — pair streaks", () => {
  it("returns each friend's streak as of the viewer's today", async () => {
    const res = await get(me, `/?today=${TODAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FriendsResponse;
    const byId = new Map(body.friends.map((f) => [f.userId, f.streak]));
    expect(byId.get(sam)).toEqual({ days: 3, viewerPostedToday: false, friendPostedToday: true });
    expect(byId.get(riley)).toEqual({
      days: 4,
      viewerPostedToday: false,
      friendPostedToday: false,
    });
    expect(byId.get(quinn)?.days).toBe(1);
    expect(byId.get(casey)?.days).toBe(0);
    expect(byId.has(stranger)).toBe(false);
  });

  it("matches the pure rule on the same days", async () => {
    const streaks = await loadFriendStreaks(me, [sam, riley, quinn], TODAY);
    const days = async (u: string) =>
      (await sql(`SELECT period_key FROM game_scores WHERE user_id = $1`, [u])).rows.map(
        (r) => (r as { period_key: string }).period_key,
      );
    const mine = await days(me);
    for (const f of [sam, riley, quinn]) {
      expect(streaks.get(f)).toEqual(computeFriendStreak(mine, await days(f), TODAY));
    }
  });

  it("lapses the streak once a full day is missed", async () => {
    // Seen two days later, nobody having posted since: the run is dead.
    const res = await get(me, `/?today=${day(2)}`);
    const body = (await res.json()) as FriendsResponse;
    expect(body.friends.every((f) => (f.streak?.days ?? 0) === 0)).toBe(true);
  });

  it("rejects a malformed today", async () => {
    expect((await get(me, "/?today=tomorrow")).status).toBe(400);
  });
});

describe("GET /v1/friends/users/:id — profile streak", () => {
  it("carries the pair streak for a friend and null for anyone else", async () => {
    const friendRes = await get(me, `/users/${riley}?period=${TODAY}`);
    expect(((await friendRes.json()) as FriendProfileResponse).streak?.days).toBe(4);
    const selfRes = await get(me, `/users/${me}?period=${TODAY}`);
    expect(((await selfRes.json()) as FriendProfileResponse).streak).toBeNull();
  });
});

describe("pickQuestPartners", () => {
  it("orders by the less recent of the two players' last days, then volume", () => {
    const picked = pickQuestPartners(
      "2026-07-01",
      [
        { friendId: "a", friendLast: "2026-06-25", friendCount: 9 },
        { friendId: "b", friendLast: "2026-07-01", friendCount: 1 },
        { friendId: "c", friendLast: "2026-07-03", friendCount: 2 },
        { friendId: "d", friendLast: "2026-06-30", friendCount: 4 },
      ],
      3,
    );
    // b and c both cap at my own last day (07-01); c has more scores.
    expect(picked.map((p) => p.friendId)).toEqual(["c", "b", "d"]);
  });
});

describe("weekly quests", () => {
  it("generates up to five quests with active friends, respecting the partner's cap", async () => {
    // Riley's five slots are already taken by their own busy friends.
    for (const b of busy.slice(0, 5)) {
      const res = await get(b, `/quests?today=${TODAY}`);
      expect(res.status).toBe(200);
    }
    const riley5 = await sql(
      `SELECT count(*)::int AS n FROM friend_quests WHERE week_start = $1 AND $2 IN (user_low, user_high)`,
      [WEEK, riley],
    );
    expect((riley5.rows[0] as { n: number }).n).toBe(5);

    const res = await get(me, `/quests?today=${TODAY}`);
    const body = (await res.json()) as FriendQuestsResponse;
    expect(body.weekStart).toBe(WEEK);
    expect(body.weekEnd).toBe("2026-07-05");
    const partners = body.quests.map((q) => q.friend.userId);
    // Not Riley (full), not Casey (never posted), not the stranger; 5 max.
    expect(partners).toHaveLength(5);
    expect(partners).not.toContain(riley);
    expect(partners).not.toContain(casey);
    expect(partners).toContain(sam);
    expect(partners).toContain(quinn);
  });

  it("is idempotent and fixes the target from the two previous weeks", async () => {
    const res = await get(me, `/quests?today=${TODAY}`);
    const body = (await res.json()) as FriendQuestsResponse;
    expect(body.quests).toHaveLength(5);
    const samQuest = body.quests.find((q) => q.friend.userId === sam);
    // Previous two weeks (06-15 … 06-28): me 06-21…06-28 = 8, Sam 06-28 = 1 → 9/2 × 1.1 → 5 → min 6.
    expect(samQuest?.target).toBe(6);
    // This week so far: me 06-29, 06-30; Sam 06-29 … 07-02 (07-02 is still this week).
    expect(samQuest?.viewerCount).toBe(2);
    expect(samQuest?.friendCount).toBe(4); // 06-29, 06-30, 07-01, 07-02
    expect(samQuest?.count).toBe(6);
  });

  it("records completion once, pushes both players once, and celebrates until seen", async () => {
    await sql(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone) VALUES
         ($1, 'ExponentPushToken[me]', 'ios', 'UTC'), ($2, 'ExponentPushToken[sam]', 'ios', 'UTC')`,
      [me, sam],
    );
    // Sam's quest reached 6 above, so that first read completed it (no tokens then).
    const first = (await (await get(me, `/quests?today=${TODAY}`)).json()) as FriendQuestsResponse;
    const samQuest = first.quests.find((q) => q.friend.userId === sam);
    expect(samQuest?.completedAt).not.toBeNull();
    expect(first.celebrations.map((q) => q.friend.userId)).toContain(sam);
    const rows = await sql(`SELECT * FROM friend_quest_completions WHERE week_start = $1`, [WEEK]);
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    // Already completed on an earlier read → no second push now.
    expect(sendExpoPushMessages).not.toHaveBeenCalled();

    const seen = await friendRoutes.request("/quests/seen", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signSession(me)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ friendId: sam, weekStart: WEEK }),
    });
    expect(seen.status).toBe(200);
    const after = (await (await get(me, `/quests?today=${TODAY}`)).json()) as FriendQuestsResponse;
    expect(after.celebrations.map((q) => q.friend.userId)).not.toContain(sam);
    // Sam still sees their own celebration.
    const samView = (await (
      await get(sam, `/quests?today=${TODAY}`)
    ).json()) as FriendQuestsResponse;
    expect(samView.celebrations.map((q) => q.friend.userId)).toContain(me);
  });

  it("a score post that reaches the target completes the quest and pushes", async () => {
    const { afterFriendScorePost } = await import("../../lib/friendActivity.js");
    const pal = extra[0] as string;
    const palQuest = (
      (await (await get(me, `/quests?today=${TODAY}`)).json()) as FriendQuestsResponse
    ).quests.find((q) => q.friend.userId === pal);
    expect(palQuest?.completedAt).toBeNull();
    await sql(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
       VALUES ($1, 'ExponentPushToken[pal]', 'ios', 'UTC')`,
      [pal],
    );
    const needed = (palQuest?.target ?? 0) - (palQuest?.count ?? 0);
    expect(needed).toBeGreaterThan(0);
    for (let i = 0; i < needed; i++) {
      const g = `00000000-0000-4000-8000-0000000004${String(i).padStart(2, "0")}`;
      await sql(`INSERT INTO games (id, normalized_url, url, title) VALUES ($1, $2, $3, $4)`, [
        g,
        `quest${i}.example`,
        `https://quest${i}.example`,
        `Quest ${i}`,
      ]);
      await score(pal, WEEK, g);
    }
    await afterFriendScorePost(pal, WEEK);
    const done = await sql(
      `SELECT score_count FROM friend_quest_completions
       WHERE week_start = $1 AND $2 IN (user_low, user_high) AND $3 IN (user_low, user_high)`,
      [WEEK, me, pal],
    );
    expect(done.rows).toHaveLength(1);
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
    const messages = sendExpoPushMessages.mock.calls[0]?.[0] as { to: string; body: string }[];
    expect(messages.map((m) => m.to).sort()).toEqual([
      "ExponentPushToken[me]",
      "ExponentPushToken[pal]",
    ]);
    // A second post the same week doesn't push again.
    await afterFriendScorePost(pal, WEEK);
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
  });
});

describe("keep-alive instrumentation", () => {
  it("records the first post of the day while a ≥2-day pair streak waited on the poster", async () => {
    // Today I haven't posted; Sam (3) and Riley (4) streaks reach yesterday.
    await score(me, TODAY);
    expect(await recordKeepalivePost(me, TODAY)).toBe(2);
    const rows = await sql(
      `SELECT friend_id, streak_days FROM friend_streak_keepalive_posts WHERE user_id = $1 ORDER BY streak_days`,
      [me],
    );
    expect(rows.rows).toEqual([
      { friend_id: sam, streak_days: 3 },
      { friend_id: riley, streak_days: 4 },
    ]);
    // A second score the same day isn't a keep-alive post.
    await score(me, TODAY, game2);
    expect(await recordKeepalivePost(me, TODAY)).toBe(0);
  });
});

describe("buildQuestCompletePushMessages", () => {
  it("names the other player on each side", () => {
    const messages = buildQuestCompletePushMessages(
      [
        { id: "a", displayName: "Ana", tokens: ["t-a"] },
        { id: "b", displayName: null, tokens: ["t-b1", "t-b2"] },
      ],
      10,
    );
    expect(messages.map((m) => [m.to, m.body])).toEqual([
      ["t-a", "You and your friend posted 10 scores together this week."],
      ["t-b1", "You and Ana posted 10 scores together this week."],
      ["t-b2", "You and Ana posted 10 scores together this week."],
    ]);
  });
});
