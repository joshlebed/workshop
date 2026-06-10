// Sparse-integer position allocator for `user_games.position` — the Games
// surface's "My Games" ordering (spec §3.1). Same scheme as `items.position`:
// the pure pieces (`computeBetween`, `shouldRebalanceForOverflow`,
// `POSITION_SPACING`) are reused from `lib/positions.ts`; the SQL is
// games-specific because rows are keyed by (user_id, game_id) instead of a
// standalone id, and the ordered scope is the viewer's selection rather than
// a list.

import { and, eq, sql } from "drizzle-orm";
import { userGames } from "../db/schema.js";
import { computeBetween, POSITION_SPACING, shouldRebalanceForOverflow } from "./positions.js";
import type { DbClient } from "./sql.js";

interface MoveArgs {
  userId: string;
  gameId: string;
  beforeGameId?: string | null;
  afterGameId?: string | null;
  db: DbClient;
}

interface MoveResult {
  position: number | null;
  rebalanced: boolean;
}

/**
 * Compute the next position for the viewer's `gameId` row, then UPDATE it.
 * Anchor semantics mirror `moveItemPosition`:
 *
 * - both null            → demote (position = NULL, sorts last)
 * - only beforeGameId    → place just after `before`
 * - only afterGameId     → place just before `after`
 * - both                 → place between them, rebalancing on collision
 */
export async function moveUserGamePosition(args: MoveArgs): Promise<MoveResult> {
  const { userId, gameId, beforeGameId, afterGameId, db } = args;

  if (!beforeGameId && !afterGameId) {
    await db
      .update(userGames)
      .set({ position: null })
      .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId)));
    return { position: null, rebalanced: false };
  }

  const attempt = async (): Promise<number | null> => {
    const beforePos = beforeGameId ? await lookupPosition(db, userId, beforeGameId) : null;
    const afterPos = afterGameId ? await lookupPosition(db, userId, afterGameId) : null;
    let lower: number | null;
    let upper: number | null;
    if (beforePos !== null && afterPos !== null) {
      lower = Math.min(beforePos, afterPos);
      upper = Math.max(beforePos, afterPos);
    } else if (beforePos !== null) {
      lower = beforePos;
      upper = await neighborPosition(db, userId, "above", beforePos);
    } else if (afterPos !== null) {
      lower = await neighborPosition(db, userId, "below", afterPos);
      upper = afterPos;
    } else {
      return null;
    }
    return computeBetween(lower, upper);
  };

  let newPos = await attempt();
  let rebalanced = false;
  if (newPos === null) {
    await rebalanceUserGames(userId, db);
    rebalanced = true;
    newPos = await attempt();
  }
  if (newPos === null) {
    // Fallback: append to the end.
    newPos = await appendUserGamePosition(userId, db);
  }
  await db
    .update(userGames)
    .set({ position: newPos })
    .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId)));

  if (!rebalanced) {
    const min = await minPosition(db, userId);
    if (shouldRebalanceForOverflow(min)) {
      await rebalanceUserGames(userId, db);
      rebalanced = true;
      newPos = await lookupPosition(db, userId, gameId);
    }
  }

  return { position: newPos, rebalanced };
}

async function lookupPosition(db: DbClient, userId: string, gameId: string) {
  const [row] = await db
    .select({ position: userGames.position })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId)))
    .limit(1);
  return row?.position ?? null;
}

async function neighborPosition(
  db: DbClient,
  userId: string,
  direction: "above" | "below",
  anchor: number,
): Promise<number | null> {
  const cmp = direction === "above" ? sql`position > ${anchor}` : sql`position < ${anchor}`;
  const order = direction === "above" ? sql`position ASC` : sql`position DESC`;
  const rows = await db
    .select({ position: userGames.position })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), sql`position IS NOT NULL`, cmp))
    .orderBy(order)
    .limit(1);
  return rows[0]?.position ?? null;
}

async function minPosition(db: DbClient, userId: string): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<number | null>`MIN(position)::int` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), sql`position IS NOT NULL`));
  const min = row?.min;
  if (min === null || min === undefined) return null;
  return Number(min);
}

async function rebalanceUserGames(userId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH renumbered AS (
      SELECT game_id,
             (ROW_NUMBER() OVER (ORDER BY position) * ${POSITION_SPACING})::int AS new_position
      FROM user_games
      WHERE user_id = ${userId}
        AND position IS NOT NULL
    )
    UPDATE user_games
    SET position = renumbered.new_position
    FROM renumbered
    WHERE user_games.user_id = ${userId}
      AND user_games.game_id = renumbered.game_id
  `);
}

/** `MAX(position) + spacing` so a newly added game sorts at the bottom. */
export async function appendUserGamePosition(userId: string, db: DbClient): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), 0)::int` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), sql`position IS NOT NULL`));
  return Number(row?.max ?? 0) + POSITION_SPACING;
}
