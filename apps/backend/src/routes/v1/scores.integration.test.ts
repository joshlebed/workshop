import { PGlite } from "@electric-sql/pglite";
import { gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import { specFromStoredRule } from "@workshop/shared/scoreParsing";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { itemScoreRoutes, listScoresRoutes } from "./scores.js";

const ownerId = "00000000-0000-4000-8000-000000000101";
const friendId = "00000000-0000-4000-8000-000000000102";
const listId = "00000000-0000-4000-8000-000000000103";
const itemId = "00000000-0000-4000-8000-000000000104";
const periodKey = "2026-06-10";

function authHeaders(asUser = ownerId): Record<string, string> {
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

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'owner@example.com', 'Owner'),
       ($2, 'friend@example.com', 'Friend')`,
    [ownerId, friendId],
  );
  await rows(
    `INSERT INTO lists (id, name, emoji, color, owner_id, item_kind, modules, share_slug)
     VALUES ($1, 'Geo games', '🎮', '#fff', $2, 'link', '{leaderboard}', 'geo1')`,
    [listId, ownerId],
  );
  await rows(
    `INSERT INTO list_members (list_id, user_id, role) VALUES
       ($1, $2, 'owner'),
       ($1, $3, 'member')`,
    [listId, ownerId, friendId],
  );
  await rows(
    `INSERT INTO items (id, list_id, title, url, kind, content, added_by)
     VALUES ($1, $2, 'Daily Tens', 'https://dailytens.com/', 'link',
             '{"siteName":"dailytens.com"}'::jsonb, $3)`,
    [itemId, listId, ownerId],
  );
}, 60_000);

describe("legacy leaderboard item score bridge", () => {
  it("uses game_scores for mapped game items while preserving the list response shape", async () => {
    const rawScore = "Daily Tens\n🏆🏆❌🏆🏆\n🏆❌🏆🏆❌\nhttps://dailytens.com/?ref=abc123";

    const upsert = await itemScoreRoutes.request(`/${itemId}/scores`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ periodKey, scoreRaw: rawScore }),
    });
    expect(upsert.status).toBe(200);
    const upsertBody = (await upsert.json()) as {
      score: { itemId: string; userId: string; scoreValue: number | null };
    };
    expect(upsertBody.score).toEqual(
      expect.objectContaining({ itemId, userId: ownerId, scoreValue: 7 }),
    );

    const mapped = await rows<{
      game_id: string | null;
      game_key: string | null;
      score_regex: string | null;
    }>(
      `SELECT i.game_id, g.game_key, i.score_regex
       FROM items i
       LEFT JOIN games g ON g.id = i.game_id
       WHERE i.id = $1`,
      [itemId],
    );
    const gameId = mapped[0]?.game_id;
    expect(gameId).toBeTruthy();
    expect(mapped[0]?.game_key).toBe("dailytens");
    // The self-heal writes the registry spec in its stored-rule encoding;
    // decode it rather than pinning the serialization.
    expect(specFromStoredRule(mapped[0]?.score_regex)).toEqual(
      gameDefinitionForKey("dailytens")?.spec,
    );

    const oldRows = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM item_scores WHERE item_id = $1`,
      [itemId],
    );
    expect(oldRows[0]?.n).toBe(0);

    const canonicalRows = await rows<{ n: number; score_value: string | null }>(
      `SELECT count(*)::int AS n, max(score_value)::text AS score_value
       FROM game_scores
       WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
      [gameId, ownerId, periodKey],
    );
    expect(canonicalRows[0]).toEqual({ n: 1, score_value: "7" });

    const myGames = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_games WHERE user_id = $1 AND game_id = $2`,
      [ownerId, gameId],
    );
    expect(myGames[0]?.n).toBe(1);

    const perItem = await itemScoreRoutes.request(`/${itemId}/scores?periodKey=${periodKey}`, {
      headers: authHeaders(),
    });
    expect(perItem.status).toBe(200);
    const perItemBody = (await perItem.json()) as {
      itemId: string;
      entries: Array<{ userId: string; scoreValue: number | null; rank: number | null }>;
    };
    expect(perItemBody.itemId).toBe(itemId);
    expect(perItemBody.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: ownerId, scoreValue: 7, rank: 1 }),
        expect.objectContaining({ userId: friendId, scoreValue: null, rank: null }),
      ]),
    );

    const perList = await listScoresRoutes.request(`/${listId}/scores?periodKey=${periodKey}`, {
      headers: authHeaders(),
    });
    expect(perList.status).toBe(200);
    const perListBody = (await perList.json()) as {
      scoresByItem: Record<string, Array<{ userId: string; scoreValue: number | null }>>;
    };
    expect(perListBody.scoresByItem[itemId]).toEqual([
      expect.objectContaining({ userId: ownerId, scoreValue: 7 }),
    ]);

    const clear = await itemScoreRoutes.request(`/${itemId}/scores?periodKey=${periodKey}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(clear.status).toBe(200);

    const afterDelete = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_scores
       WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
      [gameId, ownerId, periodKey],
    );
    expect(afterDelete[0]?.n).toBe(0);
  });
});
