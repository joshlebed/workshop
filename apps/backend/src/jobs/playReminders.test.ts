import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the DB mock so the scheduled job uses PGlite.
import { runPlayReminderJob } from "./playReminders.js";

const candidateUserId = "00000000-0000-4000-8000-000000000201";
const playedUserId = "00000000-0000-4000-8000-000000000202";
const wrongHourUserId = "00000000-0000-4000-8000-000000000203";
const noTokenUserId = "00000000-0000-4000-8000-000000000204";
const prunedToken = "ExpoPushToken[a-prune-device]";
const keptToken = "ExpoPushToken[z-keep-device]";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const result = await client.query<T>(query, params);
  return result.rows;
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
      const messages = JSON.parse(String(init?.body)) as unknown[];
      expect(messages).toEqual([
        {
          to: prunedToken,
          title: "Time to play",
          body: "Your daily games are waiting",
          data: { url: "workshop:///games" },
        },
        {
          to: keptToken,
          title: "Time to play",
          body: "Your daily games are waiting",
          data: { url: "workshop:///games" },
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

    expect(result).toEqual({ candidates: 2, skippedPlayed: 1, sent: 2, pruned: 1 });
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
    expect(result).toEqual({ candidates: 0, skippedPlayed: 0, sent: 0, pruned: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not query or send when Games is disabled", async () => {
    process.env.STAGE = "prod";
    process.env.ENABLE_GAMES = "0";
    resetConfigForTesting();
    const fetchFn = vi.fn<typeof fetch>();
    const result = await runPlayReminderJob({ fetchFn });
    expect(result).toEqual({ candidates: 0, skippedPlayed: 0, sent: 0, pruned: 0 });
    expect(fetchFn).not.toHaveBeenCalled();

    process.env.STAGE = "local";
    delete process.env.ENABLE_GAMES;
    resetConfigForTesting();
  });
});
