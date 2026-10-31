import { PGlite } from "@electric-sql/pglite";
import type { AdminGraphResponse } from "@workshop/shared";
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

const adminId = "00000000-0000-4000-8000-000000000701";
const playerId = "00000000-0000-4000-8000-000000000702";
const lurkerId = "00000000-0000-4000-8000-000000000703";
const workshopOnlyId = "00000000-0000-4000-8000-000000000704";
const gameId = "00000000-0000-4000-8000-000000000705";
const game2Id = "00000000-0000-4000-8000-000000000706";

function authHeaders(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}` };
}

async function run(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
}

function node(body: AdminGraphResponse, id: string) {
  const n = body.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`missing node ${id}`);
  return n;
}

describe("GET /v1/admin/graph", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();

    testDb = drizzle(new PGlite());
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    await run(
      `INSERT INTO users (id, email, display_name, created_at, avatar_url) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh', now() - interval '40 days', 'data:image/png;base64,AAAA'),
       ($2, 'player@example.com', 'Player', now() - interval '20 days', NULL),
       ($3, 'lurker@example.com', 'Lurker', now() - interval '10 days', NULL),
       ($4, 'lists@example.com', 'Lists only', now() - interval '5 days', NULL)`,
      [adminId, playerId, lurkerId, workshopOnlyId],
    );
    await run(
      `INSERT INTO games (id, normalized_url, url, title) VALUES
       ($1, 'wordle.test', 'https://wordle.test', 'Wordle'),
       ($2, 'connections.test', 'https://connections.test', 'Connections')`,
      [gameId, game2Id],
    );
    await run(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, created_at) VALUES
       ($1, $3, 'p1', 'Wordle 1 3/6', now() - interval '1 day'),
       ($2, $3, 'p1', 'Connections #1', now()),
       ($1, $3, 'p0', 'Wordle 0 5/6', now() - interval '9 days')`,
      [gameId, game2Id, playerId],
    );
    await run(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2), ($1, $3)`, [
      playerId,
      gameId,
      game2Id,
    ]);
    // admin <-> player (older), player <-> lurker (newer). Stored low < high.
    const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
    await run(
      `INSERT INTO friendships (user_low, user_high, created_at) VALUES ($1, $2, now() - interval '15 days')`,
      pair(adminId, playerId),
    );
    await run(
      `INSERT INTO friendships (user_low, user_high, created_at) VALUES ($1, $2, now() - interval '2 days')`,
      pair(playerId, lurkerId),
    );
    await run(
      `INSERT INTO friend_requests (inviter_id, invitee_id, status) VALUES ($1, $2, 'pending')`,
      [lurkerId, adminId],
    );
    await run(
      `INSERT INTO user_flags (user_id, key, value) VALUES ($1, 'games.share-extension-score', '{"firstAt":"2026-10-01T00:00:00Z"}')`,
      [playerId],
    );

    resetUserActivityMemoForTesting();
    await recordUserActivity(playerId, { client: "highscore", platform: "ios", appVersion: "1" });
    await recordUserActivity(playerId, { client: "highscore", platform: "web", appVersion: "1" });
    await recordUserActivity(workshopOnlyId, {
      client: "workshop",
      platform: "web",
      appVersion: "1",
    });
  }, 60_000);

  it("rejects non-admins and anonymous callers", async () => {
    expect((await adminRoutes.request("/graph", { headers: authHeaders(playerId) })).status).toBe(
      403,
    );
    expect((await adminRoutes.request("/graph")).status).toBe(401);
  });

  it("returns HighScore users with stats and every friendship edge", async () => {
    const res = await adminRoutes.request("/graph", { headers: authHeaders(adminId) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminGraphResponse;

    // Workshop-only users are not part of the HighScore web.
    expect(body.nodes.map((n) => n.id).sort()).toEqual([adminId, playerId, lurkerId].sort());
    // Oldest account first.
    expect(body.nodes[0]?.id).toBe(adminId);

    const player = node(body, playerId);
    expect(player).toMatchObject({
      displayName: "Player",
      email: "player@example.com",
      avatarVersion: null,
      isAdmin: false,
      friendCount: 2,
      pendingOut: 0,
      pendingIn: 0,
      scoreCount: 3,
      gamesScored: 2,
      gamesOnHome: 2,
      activeDays30: 1,
      activeDaysTotal: 1,
      platforms: ["ios", "web"],
      usedShareExtension: true,
    });
    expect(player.firstScoreAt && player.lastScoreAt).toBeTruthy();
    expect(player.firstScoreAt! < player.lastScoreAt!).toBe(true);

    const admin = node(body, adminId);
    expect(admin.isAdmin).toBe(true);
    expect(admin.avatarVersion).toHaveLength(8);
    expect(admin.pendingIn).toBe(1);
    expect(admin.friendCount).toBe(1);
    expect(admin.lastActiveDay).toBeNull();

    const lurker = node(body, lurkerId);
    expect(lurker.pendingOut).toBe(1);
    expect(lurker.scoreCount).toBe(0);

    expect(body.edges).toHaveLength(2);
    for (const e of body.edges) {
      expect(e.source < e.target).toBe(true);
      expect(Date.parse(e.createdAt)).not.toBeNaN();
    }
    const sorted = [...body.edges].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(new Set([sorted[0]?.source, sorted[0]?.target])).toEqual(new Set([adminId, playerId]));
  });
});
