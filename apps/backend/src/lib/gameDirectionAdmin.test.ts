// The operator's direction change: the plan it shows, what it writes, and
// that it writes nothing when the game changed under it. Real SQL (PGlite +
// the actual migrations).

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDirectionChange, planDirectionChange } from "./gameDirectionAdmin.js";
import type { DbClient } from "./sql.js";

let pglite: PGlite;
let db: DbClient;
let gameId: string;
const players = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-8000-0000000000b${i}`);

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await pglite.query<T>(query, params)).rows;
}

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  pglite = new PGlite();
  const client = drizzle(pglite);
  await migrate(client, { migrationsFolder: "./drizzle" });
  db = client as unknown as DbClient;
  for (const [i, id] of players.entries()) {
    await rows("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `d${i}@example.com`]);
  }
  const [game] = await rows<{ id: string }>(
    `INSERT INTO games (normalized_url, url, title, score_direction, direction_set_by)
     VALUES ('geohistory.gg', 'https://geohistory.gg', 'GeoHistory', 'asc', $1) RETURNING id`,
    [players[0]],
  );
  gameId = game?.id ?? "";
  // Two contested days with different winners each way, and a day with one score.
  const scores: [number, string, number][] = [
    [0, "2026-10-01", 600],
    [1, "2026-10-01", 900],
    [0, "2026-10-02", 800],
    [2, "2026-10-02", 700],
    [1, "2026-10-03", 750],
  ];
  for (const [p, day, value] of scores) {
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, parse_status)
       VALUES ($1, $2, $3, $4, $5, 'score')`,
      [gameId, players[p], day, `${value} / 1,000`, value],
    );
  }
  await rows(
    "INSERT INTO game_direction_requests (game_id, user_id, direction) VALUES ($1, $2, 'desc')",
    [gameId, players[1]],
  );
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

const game = async () => {
  const [g] = await rows<{ id: string; scoreDirection: string; direction_set_by: string | null }>(
    `SELECT id, score_direction AS "scoreDirection", direction_set_by FROM games WHERE id = $1`,
    [gameId],
  );
  if (!g) throw new Error("no game");
  return g;
};

describe("admin direction change", () => {
  it("plans without writing: which days' winners change and what it clears", async () => {
    const plan = await planDirectionChange(db, await game(), "desc");
    expect(plan).toEqual({
      from: "asc",
      to: "desc",
      pendingRequests: 1,
      contestedDays: 2,
      daysWinnerChanges: 2,
    });
    expect((await game()).scoreDirection).toBe("asc");
  });

  it("sets the direction, records the revision, clears requests and the setter", async () => {
    const result = await applyDirectionChange(db, {
      gameId,
      from: "asc",
      to: "desc",
      authoredBy: players[2] as string,
      note: "higher is better",
    });
    expect(result).toMatchObject({ stale: false, clearedRequests: 1 });
    expect(await game()).toMatchObject({ scoreDirection: "desc", direction_set_by: null });
    expect(
      await rows(
        "SELECT from_direction, to_direction, authored_by, note FROM game_direction_revisions WHERE game_id = $1",
        [gameId],
      ),
    ).toEqual([
      {
        from_direction: "asc",
        to_direction: "desc",
        authored_by: players[2],
        note: "higher is better",
      },
    ]);
    expect(
      await rows("SELECT * FROM game_direction_requests WHERE game_id = $1", [gameId]),
    ).toEqual([]);
    // No stored score moves: boards re-rank on read.
    expect(
      await rows("SELECT count(*)::int AS n FROM game_scores WHERE game_id = $1", [gameId]),
    ).toEqual([{ n: 5 }]);
  });

  it("writes nothing when the game no longer has the direction the plan was made from", async () => {
    const result = await applyDirectionChange(db, {
      gameId,
      from: "asc",
      to: "desc",
      authoredBy: players[2] as string,
      note: "again",
    });
    expect(result).toEqual({ stale: true });
    expect(
      await rows("SELECT count(*)::int AS n FROM game_direction_revisions WHERE game_id = $1", [
        gameId,
      ]),
    ).toEqual([{ n: 1 }]);
  });
});
