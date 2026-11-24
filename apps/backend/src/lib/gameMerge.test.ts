// Merging two catalog rows that are the same game: real SQL (PGlite + the
// actual migrations), real game-code writer.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shutdownGameCodeSandbox } from "./gameCode/runtime.js";
import { applyGameMerge, GAME_SCORE_COLUMNS, planGameMerge } from "./gameMerge.js";
import type { DbClient } from "./sql.js";

let pglite: PGlite;
let db: DbClient;

const admin = "00000000-0000-4000-8000-0000000000a1";
const p = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-0000000000b${i}`);
const parseCode = "function parse(raw) { return Number(raw); }";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await pglite.query<T>(query, params)).rows;
}

async function addGame(url: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols = ["normalized_url", "url", "title", ...Object.keys(extra)];
  const vals = [url, `https://${url}`, "Plain", ...Object.values(extra)];
  const [row] = await rows<{ id: string }>(
    `INSERT INTO games (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    vals,
  );
  if (!row) throw new Error("no game");
  return row.id;
}

async function score(game: string, user: string, day: string, value: number) {
  await rows(
    `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, parse_status)
     VALUES ($1, $2, $3, $4, $5, 'score')`,
    [game, user, day, String(value), value],
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  pglite = new PGlite();
  const client = drizzle(pglite);
  await migrate(client, { migrationsFolder: "./drizzle" });
  db = client as unknown as DbClient;
  await rows("INSERT INTO users (id, email) VALUES ($1, 'admin@example.com')", [admin]);
  for (const [i, id] of p.entries()) {
    await rows("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `p${i}@example.com`]);
  }
}, 60_000);

afterAll(async () => {
  await shutdownGameCodeSandbox();
  await pglite.close();
});

describe("game merge", () => {
  it("copies every game_scores column", async () => {
    const cols = await rows<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'game_scores' AND column_name <> 'game_id'",
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([...GAME_SCORE_COLUMNS].sort());
  });

  it("moves scores, players, reactions and pokes, keeps the main row's score on a clash, and moves the parser", async () => {
    const main = await addGame("playplain.app");
    const extra = await addGame("playplain.app/play", {
      parse_code: parseCode,
      code_version: 2,
      score_direction: "asc",
    });
    await score(extra, p[0] as string, "2026-11-20", 100); // moves
    await score(extra, p[1] as string, "2026-11-20", 200); // clashes: main kept
    await score(main, p[1] as string, "2026-11-20", 250);
    await score(main, p[2] as string, "2026-11-20", 300);
    await rows(
      `INSERT INTO game_score_reactions (game_id, period_key, score_user_id, reactor_user_id, emoji)
       VALUES ($1, '2026-11-20', $2, $4, '🔥'), ($1, '2026-11-20', $3, $4, '👍')`,
      [extra, p[0], p[1], p[3]],
    );
    await rows("INSERT INTO user_games (user_id, game_id) VALUES ($1, $3), ($2, $3), ($2, $4)", [
      p[0],
      p[1],
      extra,
      main,
    ]);
    await rows(
      "INSERT INTO game_nudges (sender_id, recipient_id, game_id, period_key) VALUES ($1, $2, $3, '2026-11-20')",
      [p[0], p[2], extra],
    );

    const plan = await planGameMerge(db, extra, main);
    expect(plan).toMatchObject({
      scores: { move: 1, keepInto: 1 },
      players: { move: 1, alreadyThere: 1 },
      reactions: 1,
      pokes: 1,
      items: 0,
      reports: 0,
      code: "copy",
    });

    await applyGameMerge(db, { fromId: extra, intoId: main, authoredBy: admin, note: "test" });

    expect(await rows("SELECT id FROM games WHERE id = $1", [extra])).toEqual([]);
    const scores = await rows<{ user_id: string; score_value: string }>(
      "SELECT user_id, score_value FROM game_scores WHERE game_id = $1 ORDER BY user_id",
      [main],
    );
    expect(scores.map((s) => [s.user_id, Number(s.score_value)])).toEqual([
      [p[0], 100],
      [p[1], 250],
      [p[2], 300],
    ]);
    const reactions = await rows<{ score_user_id: string }>(
      "SELECT score_user_id FROM game_score_reactions WHERE game_id = $1",
      [main],
    );
    expect(reactions.map((r) => r.score_user_id)).toEqual([p[0]]);
    const players = await rows<{ user_id: string }>(
      "SELECT user_id FROM user_games WHERE game_id = $1 ORDER BY user_id",
      [main],
    );
    expect(players.map((r) => r.user_id)).toEqual([p[0], p[1]]);
    expect(await rows("SELECT 1 FROM game_nudges WHERE game_id = $1", [main])).toHaveLength(1);

    const [game] = await rows<{
      parse_code: string;
      code_version: number;
      score_direction: string;
    }>("SELECT parse_code, code_version, score_direction FROM games WHERE id = $1", [main]);
    expect(game).toEqual({ parse_code: parseCode, code_version: 1, score_direction: "asc" });
    expect(await rows("SELECT source FROM game_code_revisions WHERE game_id = $1", [main])).toEqual(
      [{ source: "operator" }],
    );
    expect(
      await rows(
        "SELECT from_direction, to_direction FROM game_direction_revisions WHERE game_id = $1",
        [main],
      ),
    ).toEqual([{ from_direction: "desc", to_direction: "asc" }]);
  });

  it("keeps the main row's parser when both have one", async () => {
    const main = await addGame("bandle.app", { parse_code: parseCode, code_version: 1 });
    const extra = await addGame("bandle.app/menu", {
      parse_code: "function parse(raw) { return 1; }",
      code_version: 1,
    });
    expect((await planGameMerge(db, extra, main)).code).toBe("keep");
    await applyGameMerge(db, { fromId: extra, intoId: main, authoredBy: admin, note: "test" });
    const [game] = await rows<{ parse_code: string }>(
      "SELECT parse_code FROM games WHERE id = $1",
      [main],
    );
    expect(game?.parse_code).toBe(parseCode);
  });

  it("refuses to merge a game into itself", async () => {
    const id = await addGame("t30.teuteuf.fr");
    await expect(planGameMerge(db, id, id)).rejects.toThrow("itself");
  });
});
