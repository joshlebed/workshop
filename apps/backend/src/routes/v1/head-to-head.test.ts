// Head-to-head (`GET /v1/friends/users/:userId/head-to-head`) against PGlite
// with the real migrations: friends only, the range window, and who takes a
// shared day under the board's ranking rules.

import { PGlite } from "@electric-sql/pglite";
import type { HeadToHeadResponse } from "@workshop/shared/friends";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { headToHeadOutcome, rangeStart } from "../../lib/headToHead.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
vi.mock("../../lib/expoPush.js", () => ({ sendExpoPushMessages: vi.fn() }));

import { friendRoutes } from "./friends.js";

const me = "00000000-0000-4000-8000-000000000021";
const friend = "00000000-0000-4000-8000-000000000022";
const stranger = "00000000-0000-4000-8000-000000000023";
const high = "00000000-0000-4000-8000-0000000000a1"; // bigger is better
const low = "00000000-0000-4000-8000-0000000000a2"; // lower is better
const solo = "00000000-0000-4000-8000-0000000000a3"; // only I play it
const TODAY = "2026-06-30";

async function sql(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
}

async function score(
  gameId: string,
  userId: string,
  day: string,
  value: number | null,
  parseStatus: string | null = "score",
) {
  await sql(
    `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw, parse_status)
     VALUES ($1, $2, $3, $4, 'raw', $5)`,
    [gameId, userId, day, value, parseStatus],
  );
}

function get(asUser: string, target: string, query = "") {
  return friendRoutes.request(`/users/${target}/head-to-head${query}`, {
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

  await sql(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'h2h-me@example.com', 'Me'),
       ($2, 'h2h-friend@example.com', 'Friendly'),
       ($3, 'h2h-stranger@example.com', 'Stranger')`,
    [me, friend, stranger],
  );
  await sql(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [me, friend]);
  await sql(
    `INSERT INTO games (id, normalized_url, url, title, score_direction) VALUES
       ($1, 'high.example', 'https://high.example', 'High', 'desc'),
       ($2, 'low.example', 'https://low.example', 'Low', 'asc'),
       ($3, 'solo.example', 'https://solo.example', 'Solo', 'desc')`,
    [high, low, solo],
  );

  // High (desc), last 7 days: I win one, lose one, tie one; one day each alone.
  await score(high, me, "2026-06-30", 90);
  await score(high, friend, "2026-06-30", 80);
  await score(high, me, "2026-06-29", 50);
  await score(high, friend, "2026-06-29", 70);
  await score(high, me, "2026-06-28", 60);
  await score(high, friend, "2026-06-28", 60);
  await score(high, me, "2026-06-27", 10);
  await score(high, friend, "2026-06-26", 10);
  // …and an old shared day only "all" (and 30 days: no) reaches.
  await score(high, me, "2026-01-05", 1);
  await score(high, friend, "2026-01-05", 2);
  // A score dated after the viewer's today never counts.
  await score(high, me, "2026-07-01", 999);
  await score(high, friend, "2026-07-01", 1);

  // Low (asc), within 30 days: lower wins; a loss with no score ranks behind;
  // two losses tie; an unread share goes to nobody.
  await score(low, me, "2026-06-20", 3);
  await score(low, friend, "2026-06-20", 5);
  await score(low, me, "2026-06-19", null, "no_result");
  await score(low, friend, "2026-06-19", 6);
  await score(low, me, "2026-06-18", null, "no_result");
  await score(low, friend, "2026-06-18", null, "no_result");
  await score(low, me, "2026-06-17", 4);
  await score(low, friend, "2026-06-17", null, "failed");

  await score(solo, me, "2026-06-30", 5);
}, 60_000);

describe("headToHeadOutcome", () => {
  it("follows the game's direction", () => {
    expect(headToHeadOutcome({ scoreValue: 5 }, { scoreValue: 3 }, "desc")).toBe("win");
    expect(headToHeadOutcome({ scoreValue: 5 }, { scoreValue: 3 }, "asc")).toBe("loss");
    expect(headToHeadOutcome({ scoreValue: 3 }, { scoreValue: 3 }, "asc")).toBe("tie");
  });

  it("gives an unreadable day to nobody, including a legacy null", () => {
    expect(headToHeadOutcome({ scoreValue: 5 }, { scoreValue: null }, "desc")).toBe("none");
    expect(
      headToHeadOutcome({ scoreValue: null, parseStatus: "failed" }, { scoreValue: 1 }, "desc"),
    ).toBe("none");
  });
});

describe("rangeStart", () => {
  it("counts today as the first of N days", () => {
    expect(rangeStart("2026-06-30", "7")).toBe("2026-06-24");
    expect(rangeStart("2026-03-01", "30")).toBe("2026-01-31");
    expect(rangeStart("2026-06-30", "all")).toBeNull();
  });
});

describe("GET /v1/friends/users/:userId/head-to-head", () => {
  it("defaults to the last 30 days and reports every stat per shared game", async () => {
    const res = await get(me, friend, `?today=${TODAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HeadToHeadResponse;
    expect(body).toMatchObject({
      friend: { userId: friend, displayName: "Friendly" },
      range: "30",
      from: "2026-06-01",
      to: TODAY,
    });
    // Solo is not a head-to-head; most shared days first.
    expect(body.games.map((g) => g.game.title)).toEqual(["Low", "High"]);

    const [lowGame, highGame] = body.games;
    expect(highGame).toMatchObject({
      viewer: { plays: 4, averageScore: 52.5 },
      friend: { plays: 4, averageScore: 55 },
      sharedDays: 3,
      wins: 1,
      losses: 1,
      ties: 1,
    });
    expect(highGame?.days).toEqual([
      { periodKey: "2026-06-28", outcome: "tie", viewerScore: 60, friendScore: 60 },
      { periodKey: "2026-06-29", outcome: "loss", viewerScore: 50, friendScore: 70 },
      { periodKey: "2026-06-30", outcome: "win", viewerScore: 90, friendScore: 80 },
    ]);
    expect(lowGame).toMatchObject({ sharedDays: 4, wins: 1, losses: 1, ties: 1 });
    expect(lowGame?.days.map((d) => d.outcome)).toEqual(["none", "tie", "loss", "win"]);
  });

  it("mirrors for the friend", async () => {
    const res = await get(friend, me, `?today=${TODAY}`);
    const body = (await res.json()) as HeadToHeadResponse;
    const highGame = body.games.find((g) => g.game.id === high);
    expect(highGame).toMatchObject({ wins: 1, losses: 1, ties: 1, sharedDays: 3 });
  });

  it("narrows to 7 days and widens to all time", async () => {
    const week = (await (
      await get(me, friend, `?today=${TODAY}&range=7`)
    ).json()) as HeadToHeadResponse;
    expect(week.from).toBe("2026-06-24");
    expect(week.games.map((g) => g.game.title)).toEqual(["High"]);

    const all = (await (
      await get(me, friend, `?today=${TODAY}&range=all`)
    ).json()) as HeadToHeadResponse;
    expect(all.from).toBeNull();
    const highGame = all.games.find((g) => g.game.id === high);
    // The January day joins; the day after `today` still doesn't.
    expect(highGame).toMatchObject({ sharedDays: 4, wins: 1, losses: 2, ties: 1 });
    expect(highGame?.viewer.plays).toBe(5);
  });

  it("404s for non-friends, yourself and a blocked pair; 400s a bad range", async () => {
    expect((await get(me, stranger)).status).toBe(404);
    expect((await get(stranger, me)).status).toBe(404);
    expect((await get(me, me)).status).toBe(404);
    expect((await get(me, friend, "?range=90")).status).toBe(400);
    expect((await get(me, friend, "?today=yesterday")).status).toBe(400);

    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [friend, me]);
    expect((await get(me, friend, `?today=${TODAY}`)).status).toBe(404);
  });
});
