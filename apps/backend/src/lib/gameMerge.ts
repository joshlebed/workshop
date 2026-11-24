// Combining two catalog rows that are the same game. A URL path used to make a
// new game, so one game could end up under two addresses (`playplain.app` and
// `playplain.app/play`), each with its own players and board. Once an alias in
// `GAME_URL_ALIASES` stops new splits, this moves everything from the extra row
// onto the game's main row and deletes the extra row.
//
// `planGameMerge` only reads. `applyGameMerge` re-plans inside one transaction
// and writes. Operator CLI: scripts/merge-games.ts (`admin:merge-games`).

import { eq, sql } from "drizzle-orm";
import { type DbGame, gameDirectionRevisions, games } from "../db/schema.js";
import { applyGameCodeChange } from "./gameCode/admin.js";
import { logger } from "./logger.js";
import { type DbClient, executeRows } from "./sql.js";

type GameRef = Pick<DbGame, "id" | "normalizedUrl" | "title">;

export interface GameMergePlan {
  from: GameRef;
  into: GameRef;
  /** `move`: scores that move. `keepInto`: same player and day on both rows; the main row's score is kept. */
  scores: { move: number; keepInto: number };
  /** `move`: players whose My Games entry moves. `alreadyThere`: they had both. */
  players: { move: number; alreadyThere: number };
  /** Reactions on moved scores, pokes, list items and reports that point at the extra row. */
  reactions: number;
  pokes: number;
  items: number;
  reports: number;
  /**
   * `copy`: the main row has no parser and the extra row does, so its parse and
   * format code (and direction and unit) move too. `keep`: the main row's code
   * stays. `none`: neither has a parser.
   */
  code: "copy" | "keep" | "none";
}

/**
 * Every column of `game_scores`, in the order the copy writes them. The test
 * compares this with the table, so a new column can't be silently dropped.
 */
export const GAME_SCORE_COLUMNS = [
  "user_id",
  "period_key",
  "score_value",
  "score_raw",
  "parse_status",
  "score_summary",
  "score_source",
  "code_version",
  "pick",
  "pick_is_example",
  "pick_adjusted",
  "entry_source",
  "client",
  "platform",
  "app_version",
  "created_at",
  "updated_at",
] as const;

async function count(db: DbClient, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await executeRows<{ n: number | string }>(db, query);
  return Number(row?.n ?? 0);
}

async function loadGame(db: DbClient, id: string): Promise<DbGame> {
  const [row] = await db.select().from(games).where(eq(games.id, id)).limit(1);
  if (!row) throw new Error(`no game ${id}`);
  return row;
}

export async function planGameMerge(
  db: DbClient,
  fromId: string,
  intoId: string,
): Promise<GameMergePlan> {
  if (fromId === intoId) throw new Error("a game cannot be merged into itself");
  const from = await loadGame(db, fromId);
  const into = await loadGame(db, intoId);
  const f = from.id;
  const t = into.id;
  const conflict = sql`EXISTS (SELECT 1 FROM game_scores x WHERE x.game_id = ${t} AND x.user_id = s.user_id AND x.period_key = s.period_key)`;
  return {
    from: { id: f, normalizedUrl: from.normalizedUrl, title: from.title },
    into: { id: t, normalizedUrl: into.normalizedUrl, title: into.title },
    scores: {
      move: await count(
        db,
        sql`SELECT count(*) AS n FROM game_scores s WHERE s.game_id = ${f} AND NOT ${conflict}`,
      ),
      keepInto: await count(
        db,
        sql`SELECT count(*) AS n FROM game_scores s WHERE s.game_id = ${f} AND ${conflict}`,
      ),
    },
    players: {
      move: await count(
        db,
        sql`SELECT count(*) AS n FROM user_games u WHERE u.game_id = ${f}
            AND NOT EXISTS (SELECT 1 FROM user_games x WHERE x.game_id = ${t} AND x.user_id = u.user_id)`,
      ),
      alreadyThere: await count(
        db,
        sql`SELECT count(*) AS n FROM user_games u WHERE u.game_id = ${f}
            AND EXISTS (SELECT 1 FROM user_games x WHERE x.game_id = ${t} AND x.user_id = u.user_id)`,
      ),
    },
    reactions: await count(
      db,
      sql`SELECT count(*) AS n FROM game_score_reactions r WHERE r.game_id = ${f}
          AND NOT EXISTS (SELECT 1 FROM game_scores x WHERE x.game_id = ${t} AND x.user_id = r.score_user_id AND x.period_key = r.period_key)`,
    ),
    pokes: await count(
      db,
      sql`SELECT count(*) AS n FROM game_nudges p WHERE p.game_id = ${f}
          AND NOT EXISTS (SELECT 1 FROM game_nudges x WHERE x.game_id = ${t} AND x.sender_id = p.sender_id AND x.recipient_id = p.recipient_id AND x.period_key = p.period_key)`,
    ),
    items: await count(db, sql`SELECT count(*) AS n FROM items WHERE game_id = ${f}`),
    reports: await count(db, sql`SELECT count(*) AS n FROM content_reports WHERE game_id = ${f}`),
    code: into.parseCode !== null ? "keep" : from.parseCode !== null ? "copy" : "none",
  };
}

/**
 * Move everything from `fromId` onto `intoId` and delete `fromId`, in one
 * transaction. Where a player has a score for the same day on both rows, the
 * main row's score is kept. Returns the plan it carried out.
 */
export async function applyGameMerge(
  db: DbClient,
  input: { fromId: string; intoId: string; authoredBy: string; note: string },
): Promise<GameMergePlan> {
  return db.transaction(async (tx) => {
    await executeRows(
      tx,
      sql`SELECT id FROM games WHERE id IN (${input.fromId}, ${input.intoId}) FOR UPDATE`,
    );
    const plan = await planGameMerge(tx, input.fromId, input.intoId);
    const f = plan.from.id;
    const t = plan.into.id;

    if (plan.code === "copy") {
      const from = await loadGame(tx, f);
      const into = await loadGame(tx, t);
      await applyGameCodeChange(tx, {
        gameId: t,
        candidate: { parseCode: from.parseCode, formatCode: from.formatCode },
        source: "operator",
        authoredBy: input.authoredBy,
        note: `Copied from ${from.normalizedUrl} (v${from.codeVersion}) when merging it in. ${input.note}`,
        examples: [],
      });
      await tx
        .update(games)
        .set({ scoreDirection: from.scoreDirection, scoreUnit: from.scoreUnit })
        .where(eq(games.id, t));
      if (from.scoreDirection !== into.scoreDirection) {
        await tx.insert(gameDirectionRevisions).values({
          gameId: t,
          fromDirection: into.scoreDirection,
          toDirection: from.scoreDirection,
          authoredBy: input.authoredBy,
          note: `Copied from ${from.normalizedUrl} when merging it in.`,
        });
      }
    }

    const columns = sql.raw(GAME_SCORE_COLUMNS.join(", "));
    // A reaction follows its score, so only reactions on a score that moves
    // move (one statement: the copied score is the reaction's new parent).
    // Reactions on a dropped score go with it when the extra row is deleted.
    await tx.execute(sql`
      WITH moved AS (
        INSERT INTO game_scores (game_id, ${columns})
        SELECT ${t}, ${columns} FROM game_scores s
        WHERE s.game_id = ${f}
          AND NOT EXISTS (SELECT 1 FROM game_scores x WHERE x.game_id = ${t} AND x.user_id = s.user_id AND x.period_key = s.period_key)
        RETURNING user_id, period_key
      )
      UPDATE game_score_reactions r SET game_id = ${t}
      FROM moved m
      WHERE r.game_id = ${f} AND r.score_user_id = m.user_id AND r.period_key = m.period_key`);
    await tx.execute(sql`
      INSERT INTO user_games (user_id, game_id, position, added_at)
      SELECT user_id, ${t}, position, added_at FROM user_games WHERE game_id = ${f}
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      UPDATE game_nudges p SET game_id = ${t}
      WHERE p.game_id = ${f}
        AND NOT EXISTS (SELECT 1 FROM game_nudges x WHERE x.game_id = ${t} AND x.sender_id = p.sender_id AND x.recipient_id = p.recipient_id AND x.period_key = p.period_key)`);
    await tx.execute(sql`UPDATE items SET game_id = ${t} WHERE game_id = ${f}`);
    await tx.execute(sql`UPDATE content_reports SET game_id = ${t} WHERE game_id = ${f}`);
    // Everything left on the extra row (dropped scores, its code history,
    // pending direction requests) goes with it.
    await tx.delete(games).where(eq(games.id, f));

    logger.info("games merged", {
      from: plan.from.normalizedUrl,
      into: plan.into.normalizedUrl,
      scores_moved: plan.scores.move,
      scores_kept_into: plan.scores.keepInto,
      players_moved: plan.players.move,
      code: plan.code,
    });
    return plan;
  });
}
