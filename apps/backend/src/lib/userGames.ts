import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { userGames } from "../db/schema.js";
import { appendUserGamePosition } from "./gamePositions.js";
import type { DbClient } from "./sql.js";

/**
 * Append a game to My Games; keeps the existing row and position if present.
 * `created` is true only when a new row was inserted (vs already present), so
 * callers can ping ops on a genuine add and skip idempotent re-adds.
 */
export async function addToMyGames(
  userId: string,
  gameId: string,
  db: DbClient = getDb(),
): Promise<{ position: number | null; addedAt: Date; created: boolean }> {
  const position = await appendUserGamePosition(userId, db);
  const [inserted] = await db
    .insert(userGames)
    .values({ userId, gameId, position })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { position: inserted.position, addedAt: inserted.addedAt, created: true };

  const [existing] = await db
    .select()
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId)))
    .limit(1);
  if (!existing) throw new Error("user_games upsert failed");
  return { position: existing.position, addedAt: existing.addedAt, created: false };
}
