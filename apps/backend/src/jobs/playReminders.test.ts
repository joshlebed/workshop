import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { logger } from "../lib/logger.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the DB mock so the scheduled job uses PGlite.
import { autoNudgeMessage, pickAutoNudge, runPlayReminderJob } from "./playReminders.js";

const candidateUserId = "00000000-0000-4000-8000-000000000201";
const playedUserId = "00000000-0000-4000-8000-000000000202";
const wrongHourUserId = "00000000-0000-4000-8000-000000000203";
const noTokenUserId = "00000000-0000-4000-8000-000000000204";
const chunkFailureUserId = "00000000-0000-4000-8000-000000000205";
const dstUserId = "00000000-0000-4000-8000-000000000206";
const prunedToken = "ExpoPushToken[a-prune-device]";
const keptToken = "ExpoPushToken[z-keep-device]";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const result = await client.query<T>(query, params);
  return result.rows;
}

function parsePushMessages(body: unknown): unknown[] {
  const parsed = JSON.parse(String(body));
  if (!Array.isArray(parsed)) throw new TypeError("expected an Expo message array");
  return parsed;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email) VALUES
       ($1, 'candidate@example.com'),
       ($2, 'played@example.com'),
       ($3, 'wrong-hour@example.com'),
       ($4, 'no-token@example.com')`,
    [candidateUserId, playedUserId, wrongHourUserId, noTokenUserId],
  );
  await rows(
    `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour) VALUES
       ($1, true, 11),
       ($2, true, 11),
       ($3, true, 12),
       ($4, true, 11)`,
    [candidateUserId, playedUserId, wrongHourUserId, noTokenUserId],
  );
  await rows(
    `INSERT INTO push_tokens
       (user_id, expo_push_token, platform, timezone, created_at, last_seen_at) VALUES
       ($1, $2, 'ios', 'America/New_York', '2026-08-25T14:00:00Z', '2026-08-25T14:00:00Z'),
       ($1, $3, 'ios', 'America/New_York', '2026-08-25T14:01:00Z', '2026-08-25T14:01:00Z'),
       ($4, 'ExpoPushToken[played-device]', 'ios', 'America/New_York', '2026-08-25T14:00:00Z', '2026-08-25T14:00:00Z'),
       ($5, 'ExpoPushToken[wrong-hour-device]', 'ios', 'America/New_York', '2026-08-25T14:00:00Z', '2026-08-25T14:00:00Z')`,
    [candidateUserId, prunedToken, keptToken, playedUserId, wrongHourUserId],
  );
  const [game] = await rows<{ id: string }>(`SELECT id FROM games ORDER BY id LIMIT 1`);
  await rows(
    `INSERT INTO game_scores
       (game_id, user_id, period_key, score_raw, created_at, updated_at)
     VALUES ($1, $2, '2026-08-25', 'played', '2026-08-25T14:30:00Z', '2026-08-25T14:30:00Z')`,
    [game?.id, playedUserId],
  );
}, 60_000);

describe("play reminder job", () => {
  it("matches local hours, skips users who played today, and prunes invalid tickets", async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const messages = parsePushMessages(init?.body);
      expect(messages).toEqual([
        {
          to: prunedToken,
          title: "Time to play",
          body: "Your daily games are waiting",
          data: { url: "highscore:///" },
        },
        {
          to: keptToken,
          title: "Time to play",
          body: "Your daily games are waiting",
          data: { url: "highscore:///" },
        },
      ]);
      return new Response(
        JSON.stringify({
          data: [
            { status: "error", details: { error: "DeviceNotRegistered" } },
            { status: "ok", id: "ticket-1" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await runPlayReminderJob({
      now: new Date("2026-08-25T15:30:00.000Z"),
      fetchFn,
    });

    expect(result).toEqual({ candidates: 2, skippedPlayed: 1, sent: 2, pruned: 1, autoNudged: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      await rows(`SELECT 1 FROM push_tokens WHERE expo_push_token = $1`, [prunedToken]),
    ).toHaveLength(0);
    expect(
      await rows(`SELECT 1 FROM push_tokens WHERE expo_push_token = $1`, [keptToken]),
    ).toHaveLength(1);
  });

  it("does not call Expo when the current hour has no candidates", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await runPlayReminderJob({
      now: new Date("2026-08-25T17:30:00.000Z"),
      fetchFn,
    });
    expect(result).toEqual({ candidates: 0, skippedPlayed: 0, sent: 0, pruned: 0, autoNudged: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("isolates a failed Expo chunk and still prunes tickets from successful chunks", async () => {
    await rows(`INSERT INTO users (id, email) VALUES ($1, 'chunk-failure@example.com')`, [
      chunkFailureUserId,
    ]);
    await rows(
      `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour)
       VALUES ($1, true, 10)`,
      [chunkFailureUserId],
    );
    const chunkTokens = Array.from(
      { length: 101 },
      (_, index) => `ExpoPushToken[chunk-${String(index).padStart(3, "0")}]`,
    );
    for (const token of chunkTokens) {
      await rows(
        `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
         VALUES ($1, $2, 'ios', 'America/New_York')`,
        [chunkFailureUserId, token],
      );
    }

    const logError = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const messages = parsePushMessages(init?.body);
      if (fetchFn.mock.calls.length === 1) {
        return new Response(
          JSON.stringify({
            data: messages.map((_, index) =>
              index === 0
                ? { status: "error", details: { error: "DeviceNotRegistered" } }
                : { status: "ok", id: `ticket-${index}` },
            ),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("rate limited", { status: 429 });
    });

    const now = new Date("2026-08-26T14:30:00.000Z");
    const result = await runPlayReminderJob({ now, fetchFn });

    expect(result).toEqual({
      candidates: 1,
      skippedPlayed: 0,
      sent: 100,
      pruned: 1,
      autoNudged: 0,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      "play reminder push chunk failed",
      expect.objectContaining({ error: expect.any(Error), chunk_index: 1, token_count: 1 }),
    );
    expect(
      await rows(`SELECT 1 FROM push_tokens WHERE expo_push_token = $1`, [chunkTokens[0]]),
    ).toHaveLength(0);
    expect(
      await rows<{ last_reminded_at: Date }>(
        `SELECT last_reminded_at FROM notification_prefs WHERE user_id = $1`,
        [chunkFailureUserId],
      ),
    ).toEqual([{ last_reminded_at: now }]);
    logError.mockRestore();
  });

  it("deduplicates the repeated local hour on a fall-back day", async () => {
    await rows(`INSERT INTO users (id, email) VALUES ($1, 'dst@example.com')`, [dstUserId]);
    await rows(
      `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour)
       VALUES ($1, true, 1)`,
      [dstUserId],
    );
    await rows(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
       VALUES ($1, 'ExpoPushToken[dst-device]', 'ios', 'America/New_York')`,
      [dstUserId],
    );
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-dst" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const firstRun = new Date("2026-11-01T05:30:00.000Z");
    const secondRun = new Date("2026-11-01T06:30:00.000Z");
    expect(await runPlayReminderJob({ now: firstRun, fetchFn })).toMatchObject({ sent: 1 });
    expect(await runPlayReminderJob({ now: secondRun, fetchFn })).toEqual({
      candidates: 0,
      skippedPlayed: 0,
      sent: 0,
      pruned: 0,
      autoNudged: 0,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      await rows<{ last_reminded_at: Date }>(
        `SELECT last_reminded_at FROM notification_prefs WHERE user_id = $1`,
        [dstUserId],
      ),
    ).toEqual([{ last_reminded_at: firstRun }]);
  });

  it("does not query or send when Games is disabled", async () => {
    process.env.STAGE = "prod";
    process.env.ENABLE_GAMES = "0";
    resetConfigForTesting();
    const fetchFn = vi.fn<typeof fetch>();
    const result = await runPlayReminderJob({ fetchFn });
    expect(result).toEqual({ candidates: 0, skippedPlayed: 0, sent: 0, pruned: 0, autoNudged: 0 });
    expect(fetchFn).not.toHaveBeenCalled();

    process.env.STAGE = "local";
    delete process.env.ENABLE_GAMES;
    resetConfigForTesting();
  });
});

describe("automatic friends-played nudge (spike 4)", () => {
  const u = (n: number) => `00000000-0000-4000-8000-000000000${n}`;
  const twoPlayed = u(301); // friends 1 + 2 posted, friend 3 hasn't → "played" copy
  const onlyOne = u(302); // every friend with the game posted → "only one" copy
  const onePlayed = u(303); // only one friend posted → plain reminder
  const blockedPair = u(304); // two posted, but one is blocked → plain reminder
  const [f1, f2, f3] = [u(311), u(312), u(313)];
  const NOW = new Date("2026-08-27T18:15:00.000Z"); // 18:00 UTC slot
  const DAY = "2026-08-27";
  let gameA = "";
  let gameB = "";

  function okFetch(sent: unknown[][]) {
    return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const messages = parsePushMessages(init?.body);
      sent.push(messages);
      return new Response(
        JSON.stringify({ data: messages.map((_, i) => ({ status: "ok", id: `t${i}` })) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
  }

  beforeAll(async () => {
    const targets = [twoPlayed, onlyOne, onePlayed, blockedPair];
    for (const id of [...targets, f1, f2, f3]) {
      await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
        id,
        `${id}@example.com`,
        id === f1 ? "Sam" : id === f2 ? "Riley" : id === f3 ? "Quinn" : "Target",
      ]);
    }
    for (const id of targets) {
      await rows(
        `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour)
         VALUES ($1, true, 18)`,
        [id],
      );
      await rows(
        `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
         VALUES ($1, $2, 'ios', 'UTC')`,
        [id, `ExpoPushToken[${id.slice(-3)}]`],
      );
    }
    const [a] = await rows<{ id: string }>(
      `INSERT INTO games (normalized_url, url, title) VALUES ('example.com/maptap', 'https://example.com/maptap', 'MapTap') RETURNING id`,
    );
    const [b] = await rows<{ id: string }>(
      `INSERT INTO games (normalized_url, url, title) VALUES ('example.com/tens', 'https://example.com/tens', 'Daily Tens') RETURNING id`,
    );
    gameA = a?.id ?? "";
    gameB = b?.id ?? "";
    const friend = async (x: string, y: string) => {
      const [low, high] = x < y ? [x, y] : [y, x];
      await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
    };
    const has = (userId: string, gameId: string) =>
      rows(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)`, [userId, gameId]);
    const post = (userId: string, gameId: string, at: string) =>
      rows(
        `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, created_at, updated_at)
         VALUES ($1, $2, $3, 'x', $4, $4)`,
        [gameId, userId, DAY, at],
      );
    for (const t of targets) for (const f of [f1, f2, f3]) await friend(t, f);
    // Game A: every target has it, so do all three friends; Sam then Riley posted.
    for (const id of [...targets, f1, f2, f3]) await has(id, gameA);
    await post(f1, gameA, "2026-08-27T08:00:00Z");
    await post(f2, gameA, "2026-08-27T09:00:00Z");
    // Game B: only `onlyOne`, Sam and Riley have it, and both posted.
    for (const id of [onlyOne, f1, f2]) await has(id, gameB);
    await post(f1, gameB, "2026-08-27T10:00:00Z");
    await post(f2, gameB, "2026-08-27T11:00:00Z");
    // `onePlayed` is friends with Sam only for game purposes: drop Riley.
    await rows(
      `DELETE FROM friendships WHERE (user_low = $1 AND user_high = $2) OR (user_low = $2 AND user_high = $1)`,
      [onePlayed, f2],
    );
    await rows(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
      f2,
      blockedPair,
    ]);
  });

  it("sends the friends-played push instead of the reminder, once per user per day", async () => {
    const sent: unknown[][] = [];
    const result = await runPlayReminderJob({ now: NOW, fetchFn: okFetch(sent) });
    expect(result).toMatchObject({ candidates: 4, sent: 4, autoNudged: 2 });
    const byToken = new Map(
      sent.flat().map((m) => [(m as { to: string }).to, m as Record<string, unknown>]),
    );
    expect(byToken.get(`ExpoPushToken[${twoPlayed.slice(-3)}]`)).toEqual({
      to: `ExpoPushToken[${twoPlayed.slice(-3)}]`,
      title: "Sam and Riley played MapTap today",
      body: "Your turn — post your score",
      data: { kind: "auto_nudge", gameId: gameA, url: `highscore:///games/${gameA}?date=${DAY}` },
    });
    // Two games qualify; Daily Tens wins the tie because nobody is left on it.
    expect(byToken.get(`ExpoPushToken[${onlyOne.slice(-3)}]`)).toMatchObject({
      title: "You're the only one who hasn't played Daily Tens today",
      body: "Sam and Riley are waiting",
    });
    for (const plain of [onePlayed, blockedPair]) {
      expect(byToken.get(`ExpoPushToken[${plain.slice(-3)}]`)).toMatchObject({
        title: "Time to play",
      });
    }
    expect(
      await rows(
        `SELECT user_id, period_key, game_id, friend_ids FROM auto_nudges ORDER BY user_id`,
      ),
    ).toEqual([
      { user_id: twoPlayed, period_key: DAY, game_id: gameA, friend_ids: [f1, f2] },
      { user_id: onlyOne, period_key: DAY, game_id: gameB, friend_ids: [f1, f2] },
    ]);

    // Even with the reminder dedup cleared, the auto nudge never repeats that day.
    await rows(`UPDATE notification_prefs SET last_reminded_at = NULL WHERE user_id = $1`, [
      twoPlayed,
    ]);
    const again: unknown[][] = [];
    expect(await runPlayReminderJob({ now: NOW, fetchFn: okFetch(again) })).toMatchObject({
      candidates: 1,
      autoNudged: 0,
    });
    expect(again.flat()).toEqual([expect.objectContaining({ title: "Time to play" })]);
  });

  it("releases the claim when Expo never answered", async () => {
    await rows(`DELETE FROM auto_nudges`);
    await rows(`UPDATE notification_prefs SET last_reminded_at = NULL WHERE user_id = $1`, [
      twoPlayed,
    ]);
    const failing = vi.fn(async () => new Response("down", { status: 503 }));
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = await runPlayReminderJob({ now: NOW, fetchFn: failing });
    errorSpy.mockRestore();
    expect(result).toMatchObject({ sent: 0, autoNudged: 0 });
    expect(await rows(`SELECT 1 FROM auto_nudges`)).toHaveLength(0);
  });
});

describe("pickAutoNudge / autoNudgeMessage", () => {
  const row = (over: Partial<Parameters<typeof pickAutoNudge>[0][number]>) => ({
    userId: "u",
    periodKey: "2026-08-27",
    gameId: "g",
    title: "MapTap",
    position: 1,
    postedIds: ["a", "b"],
    postedNames: ["Sam", "Riley"],
    waitingCount: 0,
    ...over,
  });

  it("needs two friends and prefers more of them", () => {
    expect(pickAutoNudge([row({ postedIds: ["a"], postedNames: ["Sam"] })])).toBeNull();
    expect(
      pickAutoNudge([
        row({ gameId: "two" }),
        row({ gameId: "three", postedIds: ["a", "b", "c"], postedNames: ["Sam", "Riley", null] }),
      ])?.gameId,
    ).toBe("three");
  });

  it("names three or more friends briefly", () => {
    expect(
      autoNudgeMessage(
        row({ postedIds: ["a", "b", "c", "d"], postedNames: ["Sam", "Riley", null, "Q"] }),
      ),
    ).toMatchObject({
      title: "You're the only one who hasn't played MapTap today",
      body: "Sam, Riley and 2 more are waiting",
    });
  });
});
