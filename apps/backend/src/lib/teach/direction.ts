// Score direction (lower or higher wins) under the two-user rule: the user
// who set a game's direction can change it; anyone else's change is recorded
// and takes effect when a second user asks for the same one.

import type { GameScoreDirection } from "@workshop/shared/games";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { type DbGame, gameDirectionRequests, games } from "../../db/schema.js";
import { normalizeScoreDirection } from "../gameCatalog.js";
import { notifyDirectionChanged } from "../opsNotifications.js";
import type { DbClient } from "../sql.js";
import { logTeachEvent, type TeachLogContext } from "./log.js";

/** Users who must ask for the same change before it applies (unless the setter asks). */
const REQUESTS_TO_APPLY = 2;

export async function requestDirection(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  direction: GameScoreDirection;
  db?: DbClient;
}): Promise<{ game: DbGame; applied: boolean }> {
  const { userId, game, direction } = input;
  const db = input.db ?? getDb();
  const from = normalizeScoreDirection(game.scoreDirection);
  const context = { ...input.context, parserVersion: game.codeVersion };
  const mine = and(
    eq(gameDirectionRequests.gameId, game.id),
    eq(gameDirectionRequests.userId, userId),
  );

  if (direction === from) {
    // Asking for what is already true withdraws any pending request to flip it.
    await db.delete(gameDirectionRequests).where(mine);
    logTeachEvent("direction_change", context, { from, to: direction, result: "unchanged" });
    return { game, applied: true };
  }

  const result = await db.transaction(async (tx) => {
    let apply = game.directionSetBy === userId;
    if (!apply) {
      await tx
        .insert(gameDirectionRequests)
        .values({ gameId: game.id, userId, direction })
        .onConflictDoUpdate({
          target: [gameDirectionRequests.gameId, gameDirectionRequests.userId],
          set: { direction, createdAt: new Date() },
        });
      const asking = await tx
        .select({ userId: gameDirectionRequests.userId })
        .from(gameDirectionRequests)
        .where(
          and(
            eq(gameDirectionRequests.gameId, game.id),
            eq(gameDirectionRequests.direction, direction),
          ),
        );
      apply = asking.length >= REQUESTS_TO_APPLY;
    }
    if (!apply) return { game, applied: false };
    const [updated] = await tx
      .update(games)
      // Settled by two users, nobody owns it; changed by its setter, they still do.
      .set({
        scoreDirection: direction,
        directionSetBy: game.directionSetBy === userId ? userId : null,
      })
      .where(eq(games.id, game.id))
      .returning();
    await tx.delete(gameDirectionRequests).where(eq(gameDirectionRequests.gameId, game.id));
    return { game: updated ?? game, applied: true };
  });

  logTeachEvent("direction_change", context, {
    from,
    to: direction,
    result: result.applied ? "applied" : "held",
  });
  if (result.applied) {
    await notifyDirectionChanged(userId, { gameTitle: game.title, from, to: direction });
  }
  return result;
}
