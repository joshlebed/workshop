import { PGlite } from "@electric-sql/pglite";
import type { AdminAnalyticsResponse } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";
import { recordUserActivity, resetUserActivityMemoForTesting } from "../../lib/userActivity.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { adminRoutes } from "./admin.js";

const adminId = "00000000-0000-4000-8000-000000000601";
const playerId = "00000000-0000-4000-8000-000000000602";
const lurkerId = "00000000-0000-4000-8000-000000000603";
const gameId = "00000000-0000-4000-8000-000000000604";
const listId = "00000000-0000-4000-8000-000000000605";

function authHeaders(asUser: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, ...extra };
}

async function run(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
}

function series(body: AdminAnalyticsResponse, key: string) {
  const s = body.series.find((x) => x.key === key);
  if (!s) throw new Error(`missing series ${key}`);
  return s;
}

function stat(body: AdminAnalyticsResponse, key: string) {
  const s = body.stats.find((x) => x.key === key);
  if (!s) throw new Error(`missing stat ${key}`);
  return s.value;
}

const today = new Date().toISOString().slice(0, 10);

describe("GET /v1/admin/analytics", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();

    testDb = drizzle(new PGlite());
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    await run(
      `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'),
       ($2, 'player@example.com', 'Player'),
       ($3, 'lurker@example.com', 'Lurker')`,
      [adminId, playerId, lurkerId],
    );
    await run(
      `INSERT INTO games (id, normalized_url, url, title) VALUES ($1, 'wordle.test', 'https://wordle.test', 'Wordle')`,
      [gameId],
    );
    await run(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, created_at) VALUES
       ($1, $2, 'p1', 'Wordle 1 3/6', now()),
       ($1, $3, 'p1', 'Wordle 1 4/6', now()),
       ($1, $2, 'p0', 'Wordle 0 5/6', now() - interval '2 days')`,
      [gameId, playerId, lurkerId],
    );
    await run(
      `INSERT INTO lists (id, name, emoji, color, owner_id, share_slug) VALUES ($1, 'Books', '📚', 'ocean', $2, 'books-slug')`,
      [listId, playerId],
    );
    await run(
      `INSERT INTO items (list_id, title, added_by) VALUES ($1, 'Dune', $2), ($1, 'Emma', $2)`,
      [listId, playerId],
    );

    resetUserActivityMemoForTesting();
    await recordUserActivity(playerId, "highscore");
    await recordUserActivity(lurkerId, "highscore");
    await recordUserActivity(playerId, "workshop");
    await recordUserActivity(playerId, null); // header-less → workshop, de-duped
  }, 60_000);

  it("rejects non-admins", async () => {
    const res = await adminRoutes.request("/analytics", { headers: authHeaders(playerId) });
    expect(res.status).toBe(403);
  });

  it("rejects anonymous callers", async () => {
    const res = await adminRoutes.request("/analytics");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown range", async () => {
    const res = await adminRoutes.request("/analytics?range=13", { headers: authHeaders(adminId) });
    expect(res.status).toBe(400);
  });

  it("serves the HighScore dashboard with scores per day and active users", async () => {
    const res = await adminRoutes.request("/analytics?client=highscore&range=7", {
      headers: authHeaders(adminId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminAnalyticsResponse;
    expect(body.client).toBe("highscore");
    expect(body.rangeDays).toBe(7);
    expect(series(body, "dau").points).toHaveLength(7);
    expect(series(body, "dau").points.at(-1)).toEqual({ day: today, value: 2 });
    expect(series(body, "mau").points.at(-1)?.value).toBe(2);
    expect(series(body, "scores").points.at(-1)?.value).toBe(2);
    expect(series(body, "scores").points.reduce((a, p) => a + p.value, 0)).toBe(3);
    expect(series(body, "scorers").points.at(-1)?.value).toBe(2);
    expect(series(body, "new_users").points.at(-1)?.value).toBe(2);
    expect(stat(body, "active_today")).toBe(2);
    expect(stat(body, "users_total")).toBe(2);
    expect(stat(body, "scores_7d")).toBe(3);
    expect(body.series.find((s) => s.key === "items")).toBeUndefined();
  });

  it("serves the Workshop dashboard with items and lists per day", async () => {
    const res = await adminRoutes.request("/analytics?client=workshop", {
      headers: authHeaders(adminId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminAnalyticsResponse;
    expect(body.rangeDays).toBe(30);
    expect(series(body, "dau").points).toHaveLength(30);
    expect(stat(body, "active_today")).toBe(1);
    expect(series(body, "items").points.at(-1)?.value).toBe(2);
    expect(series(body, "lists").points.at(-1)?.value).toBe(1);
    expect(stat(body, "items_7d")).toBe(2);
    expect(body.series.find((s) => s.key === "scores")).toBeUndefined();
  });

  it("rolls a one-year window up into weekly buckets", async () => {
    const res = await adminRoutes.request("/analytics?client=highscore&range=365", {
      headers: authHeaders(adminId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminAnalyticsResponse;
    expect(body.bucket).toBe("week");
    expect(body.rangeDays).toBe(365);
    // 365 days → 52 full weeks + one 1-day bucket at the start.
    expect(series(body, "dau").points).toHaveLength(53);
    expect(series(body, "dau").label).toBe("Weekly active users");
    const lastWeek = series(body, "dau").points.at(-1);
    expect(lastWeek?.value).toBe(2);
    // Scores: 3 in the last 7 days (2 today + 1 two days ago) summed into one bar.
    expect(series(body, "scores").points.at(-1)?.value).toBe(3);
    // Scorers are distinct within the week (player scored twice, lurker once).
    expect(series(body, "scorers").points.at(-1)?.value).toBe(2);
    expect(stat(body, "scores_7d")).toBe(3);
    // Weekly MAU is the end-of-week snapshot, not a sum.
    expect(series(body, "mau").points.at(-1)?.value).toBe(2);
  });

  it("defaults the client to the calling app's X-Workshop-Client header", async () => {
    // Routed through requestLog in the real app; here the route reads the
    // context directly, so an explicit header without the context store means
    // the Workshop default applies. The explicit query param is the contract.
    const res = await adminRoutes.request("/analytics", {
      headers: authHeaders(adminId, { "X-Workshop-Client": "highscore" }),
    });
    const body = (await res.json()) as AdminAnalyticsResponse;
    expect(body.client).toBe("workshop");
  });
});
