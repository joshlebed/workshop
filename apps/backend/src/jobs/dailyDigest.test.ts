import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import type { DbClient } from "../lib/sql.js";
import {
  buildDailyDigestMessage,
  type DailyDigest,
  loadDailyDigest,
  runDailyDigestJob,
} from "./dailyDigest.js";

// 09:02 ET on Tue Nov 24, so the digest day is Mon Nov 23 ET (05:00Z → 05:00Z).
const NOW = new Date("2026-11-24T14:02:00Z");
const IN_WINDOW = "2026-11-23T15:00:00Z";
const BEFORE_WINDOW = "2026-11-23T04:59:00Z";
const AFTER_WINDOW = "2026-11-24T05:00:00Z";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const base: DailyDigest = {
  windowStart: new Date("2026-11-23T05:00:00Z"),
  windowEnd: new Date("2026-11-24T05:00:00Z"),
  signups: 3,
  signupsScored: 2,
  recentSignups: 56,
  recentNeverScored: 25,
  activeUsers: 18,
  activeUsersWeekAvg: 16.43,
  scores: 142,
  gamesAdded: 12,
  friendships: 3,
  firstScores: 2,
  firstFriends: 1,
  listsCreated: 1,
  listsArchived: 0,
  listsJoined: 0,
  letterboxdConnected: 0,
  nudgesBoard: 0,
  nudgesPostNotice: 0,
  autoNudges: 0,
  priorPostNotice: 0,
  priorPostNoticeAnswered: 0,
  priorAutoNudges: 0,
  priorAutoNudgesAnswered: 0,
};

describe("buildDailyDigestMessage", () => {
  it("is short, leads with the funnel and hides zero counts", () => {
    expect(buildDailyDigestMessage(base)).toBe(
      [
        "📊 **Daily digest** · Mon, Nov 23",
        "**Signups:** 3 → 2 posted a score",
        "**Never scored:** 25 of 56 signups in the last 30 days (45%)",
        "**HighScore:** 18 active (7-day avg 16.4) · 142 scores",
        "**Activity:** 12 games added · 3 friendships · 2 first scores · 1 first friend after signup",
        "**Lists:** 1 new",
      ].join("\n"),
    );
  });

  it("reports nudges by surface and how many were answered within 24h", () => {
    const message = buildDailyDigestMessage({
      ...base,
      nudgesBoard: 1,
      nudgesPostNotice: 4,
      autoNudges: 2,
      priorPostNotice: 3,
      priorPostNoticeAnswered: 2,
      priorAutoNudges: 1,
      priorAutoNudgesAnswered: 0,
    });
    expect(message).toContain(
      "**Nudges:** 1 poke · 4 after posting · 2 auto · 2/3 after-posting nudges from the day before answered in 24h · 0/1 auto nudges from the day before answered in 24h",
    );
  });

  it("drops empty sections and survives a day with no signups in 30 days", () => {
    const quiet = buildDailyDigestMessage({
      ...base,
      signups: 0,
      signupsScored: 0,
      recentSignups: 0,
      recentNeverScored: 0,
      activeUsers: 0,
      activeUsersWeekAvg: 0,
      scores: 0,
      gamesAdded: 0,
      friendships: 0,
      firstScores: 0,
      firstFriends: 0,
      listsCreated: 0,
    });
    expect(quiet).toContain("**Never scored:** 0 of 0 signups in the last 30 days");
    expect(quiet).not.toContain("NaN");
    expect(quiet).not.toContain("**Activity:**");
    expect(quiet).not.toContain("**Lists:**");
  });
});

describe("daily digest job", () => {
  let client: PGlite;
  let db: DbClient;

  async function user(n: number, createdAt: string, extra = "") {
    await client.query(
      `INSERT INTO users (id, email, display_name, created_at${extra ? ", letterboxd_connected_at" : ""})
       VALUES ($1, $2, $3, $4${extra ? `, '${extra}'` : ""})`,
      [id(n), `u${n}@example.test`, `User ${n}`, createdAt],
    );
  }
  async function score(userN: number, gameId: string, day: string, createdAt: string) {
    await client.query(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, created_at, updated_at)
       VALUES ($1, $2, $3, 'x', $4, $4)`,
      [gameId, id(userN), day, createdAt],
    );
  }

  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    process.env.LOG_LEVEL = "error";
    resetConfigForTesting();
    client = new PGlite();
    const testDb = drizzle(client);
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    db = testDb as unknown as DbClient;

    const game = await client.query<{ id: string }>(
      `INSERT INTO games (title, url, normalized_url)
       VALUES ('Test', 'https://g.example', 'g.example') RETURNING id`,
    );
    const gameId = game.rows[0]?.id ?? "";

    await user(1, IN_WINDOW); // signup in window, scored, first friend
    await user(2, IN_WINDOW, IN_WINDOW); // signup in window, never scored, Letterboxd
    await user(3, "2026-11-10T12:00:00Z"); // recent, never scored
    await user(4, "2026-01-01T12:00:00Z"); // old, active in window
    await user(5, BEFORE_WINDOW); // the minute before the window
    await user(6, AFTER_WINDOW); // today: outside every count

    await score(1, gameId, "2026-11-23", IN_WINDOW);
    await score(4, gameId, "2026-11-23", IN_WINDOW);
    await score(4, gameId, "2026-11-22", "2026-11-22T15:00:00Z");
    await score(6, gameId, "2026-11-24", AFTER_WINDOW);

    await client.query(`INSERT INTO user_games (user_id, game_id, added_at) VALUES ($1, $2, $3)`, [
      id(1),
      gameId,
      IN_WINDOW,
    ]);
    await client.query(
      `INSERT INTO friendships (user_low, user_high, created_at) VALUES ($1, $2, $3)`,
      [id(1), id(4), IN_WINDOW],
    );
    const list = await client.query<{ id: string }>(
      `INSERT INTO lists (owner_id, name, emoji, color, share_slug, created_at, archived_at)
       VALUES ($1, 'L', '📋', 'blue', 'digest-test', $2, $2) RETURNING id`,
      [id(4), IN_WINDOW],
    );
    const listId = list.rows[0]?.id ?? "";
    await client.query(
      `INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES
       ($1, $2, 'owner', $4), ($1, $3, 'member', $4)`,
      [listId, id(4), id(1), IN_WINDOW],
    );
  }, 60_000);

  it("counts the previous Eastern day and nothing outside it", async () => {
    expect(await loadDailyDigest(db, NOW)).toMatchObject({
      windowStart: new Date("2026-11-23T05:00:00Z"),
      windowEnd: new Date("2026-11-24T05:00:00Z"),
      signups: 2,
      signupsScored: 1,
      recentSignups: 4,
      recentNeverScored: 3, // users 2, 3 and 5
      activeUsers: 2, // users 1 and 4
      scores: 2,
      gamesAdded: 1,
      friendships: 1,
      firstScores: 1, // user 1; user 4's first score was the day before
      firstFriends: 1,
      listsCreated: 1,
      listsArchived: 1,
      listsJoined: 1, // the owner row is not a join
      letterboxdConnected: 1,
      nudgesBoard: 0,
      nudgesPostNotice: 0,
      autoNudges: 0,
    });
  });

  it("averages active user-days over the week", async () => {
    // Monday: users 1 and 4. Sunday: user 4. Three user-days over seven days.
    const digest = await loadDailyDigest(db, NOW);
    expect(digest.activeUsersWeekAvg).toBeCloseTo(3 / 7);
  });

  it("handles a 25-hour DST day with no gap", async () => {
    const digest = await loadDailyDigest(db, new Date("2026-11-02T14:02:00Z"));
    expect(digest.windowStart.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(digest.windowEnd.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("sends one message and reports whether Discord took it", async () => {
    const notify = vi.fn(async (_content: string) => false);
    expect(await runDailyDigestJob({ now: NOW, db, notify })).toEqual({ delivered: false });
    expect(notify).toHaveBeenCalledTimes(1);
    const message = notify.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("**Signups:** 2 → 1 posted a score");
    expect(message).not.toContain("User ");
    expect(message).not.toContain("@example");
  });
});
