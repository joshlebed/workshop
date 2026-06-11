import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

describe("0029_finish_games_backfill", () => {
  it("adds every historical scorer to My Games without creating friendships", async () => {
    const pglite = new PGlite();
    const testDb = drizzle(pglite);
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
      const res = await pglite.query<T>(query, params);
      return res.rows;
    }

    async function runFinishBackfill() {
      const sql = readFileSync(
        new URL("../../drizzle/0029_finish_games_backfill.sql", import.meta.url),
        "utf8",
      );
      for (const statement of sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean)) {
        await pglite.query(statement);
      }
    }

    const userA = "00000000-0000-4000-8000-000000000201";
    const userB = "00000000-0000-4000-8000-000000000202";
    const ownerId = "00000000-0000-4000-8000-000000000203";
    const listId = "00000000-0000-4000-8000-000000000204";
    const dailyTensItemId = "00000000-0000-4000-8000-000000000205";
    const genericItemId = "00000000-0000-4000-8000-000000000206";

    await rows(
      `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'a@example.com', 'A'),
       ($2, 'b@example.com', 'B'),
       ($3, 'owner@example.com', 'Owner')`,
      [userA, userB, ownerId],
    );

    const gameRows = await rows<{ id: string; normalized_url: string }>(
      `SELECT id, normalized_url
       FROM games
       WHERE normalized_url IN ('maptap.gg', 'globle-game.com', 'dailytens.com', 'nytimes.com/games/wordle')`,
    );
    const gameId = new Map(gameRows.map((g) => [g.normalized_url, g.id]));
    const maptapId = gameId.get("maptap.gg");
    const globleId = gameId.get("globle-game.com");
    const dailyTensId = gameId.get("dailytens.com");
    const wordleId = gameId.get("nytimes.com/games/wordle");
    expect({ maptapId, globleId, dailyTensId, wordleId }).toEqual({
      maptapId: expect.any(String),
      globleId: expect.any(String),
      dailyTensId: expect.any(String),
      wordleId: expect.any(String),
    });

    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw, created_at, updated_at)
       VALUES
       ($1, $3, '2026-06-08', 710, 'Final score: 710', '2026-06-08T12:00:00Z', '2026-06-08T12:00:00Z'),
       ($1, $3, '2026-06-09', 770, 'Final score: 770', '2026-06-09T12:00:00Z', '2026-06-09T12:00:00Z'),
       ($2, $3, '2026-06-09', 4, '⬜🟨🟩 = 4', '2026-06-09T12:05:00Z', '2026-06-09T12:05:00Z')`,
      [maptapId, globleId, userA],
    );

    await rows(
      `INSERT INTO user_games (user_id, game_id, position, added_at)
       VALUES
       ($1, $2, 2048, '2026-06-08T12:00:00Z'),
       ($1, $3, 1024, '2026-06-09T12:05:00Z'),
       ($1, $4, 512, '2026-06-10T12:00:00Z')`,
      [userA, maptapId, globleId, wordleId],
    );

    await rows(
      `INSERT INTO lists (id, name, emoji, color, owner_id, item_kind, modules, share_slug)
       VALUES ($1, 'Geo games', '🎮', '#fff', $2, 'link', '{leaderboard}', 'geo2')`,
      [listId, ownerId],
    );
    await rows(
      `INSERT INTO items (id, list_id, title, url, kind, content, added_by)
       VALUES ($1, $2, 'Daily Tens', 'https://dailytens.com/', 'link',
               '{"siteName":"dailytens.com"}'::jsonb, $4),
              ($3, $2, 'Odd Game', 'https://games.example.com/daily?ref=abc', 'link',
               '{"siteName":"games.example.com"}'::jsonb, $4)`,
      [dailyTensItemId, listId, genericItemId, ownerId],
    );
    await rows(
      `INSERT INTO item_scores (item_id, user_id, period_key, score_value, score_raw, created_at, updated_at)
       VALUES
       ($1, $3, '2026-06-09', 8, '🏆🏆🏆🏆🏆🏆🏆🏆❌❌', '2026-06-09T12:10:00Z', '2026-06-09T12:10:00Z'),
       ($2, $3, '2026-06-10', 42, 'Odd Game score: 42', '2026-06-10T12:11:00Z', '2026-06-10T12:11:00Z')`,
      [dailyTensItemId, genericItemId, userB],
    );

    await runFinishBackfill();

    const userAOrder = await rows<{ normalized_url: string; position: number }>(
      `SELECT g.normalized_url, ug.position
       FROM user_games ug
       JOIN games g ON g.id = ug.game_id
       WHERE ug.user_id = $1
       ORDER BY ug.position ASC`,
      [userA],
    );
    expect(userAOrder).toEqual([
      { normalized_url: "maptap.gg", position: 1024 },
      { normalized_url: "globle-game.com", position: 2048 },
      { normalized_url: "nytimes.com/games/wordle", position: 3072 },
    ]);

    const userBBackfill = await rows<{
      user_game_count: number;
      canonical_score_count: number;
      legacy_score_count: number;
      item_game_id: string | null;
      score_regex: string | null;
    }>(
      `SELECT
         (SELECT count(*)::int FROM user_games WHERE user_id = $1 AND game_id = $2) AS user_game_count,
         (SELECT count(*)::int FROM game_scores WHERE user_id = $1 AND game_id = $2) AS canonical_score_count,
         (SELECT count(*)::int FROM item_scores WHERE user_id = $1 AND item_id = $3) AS legacy_score_count,
         (SELECT game_id FROM items WHERE id = $3) AS item_game_id,
         (SELECT score_regex FROM items WHERE id = $3) AS score_regex`,
      [userB, dailyTensId, dailyTensItemId],
    );
    expect(userBBackfill[0]).toEqual({
      user_game_count: 1,
      canonical_score_count: 1,
      legacy_score_count: 1,
      item_game_id: dailyTensId,
      score_regex: "count:🏆",
    });

    const genericBackfill = await rows<{
      normalized_url: string;
      user_game_count: number;
      canonical_score_count: number;
      legacy_score_count: number;
    }>(
      `SELECT
         g.normalized_url,
         (SELECT count(*)::int FROM user_games WHERE user_id = $1 AND game_id = g.id) AS user_game_count,
         (SELECT count(*)::int FROM game_scores WHERE user_id = $1 AND game_id = g.id) AS canonical_score_count,
         (SELECT count(*)::int FROM item_scores WHERE user_id = $1 AND item_id = $2) AS legacy_score_count
       FROM items i
       JOIN games g ON g.id = i.game_id
       WHERE i.id = $2`,
      [userB, genericItemId],
    );
    expect(genericBackfill[0]).toEqual({
      normalized_url: "games.example.com/daily",
      user_game_count: 1,
      canonical_score_count: 1,
      legacy_score_count: 1,
    });

    const missingMemberships = await rows<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM (
         SELECT DISTINCT user_id, game_id FROM game_scores
         EXCEPT
         SELECT user_id, game_id FROM user_games
       ) missing`,
    );
    expect(missingMemberships[0]?.n).toBe(0);

    const friendshipsCreated = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM friendships`,
    );
    expect(friendshipsCreated[0]?.n).toBe(0);
  }, 60_000);
});
