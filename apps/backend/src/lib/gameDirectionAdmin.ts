// Changing a game's score direction (which end of the board wins) as an
// operator. The operator script (scripts/set-game-direction.ts) is a thin
// CLI over this. Users change direction in the app under the two-user rule
// (lib/teach/direction.ts); this is the override for a direction that is
// simply wrong, with a revision that says who changed it and why.

import type { GameScoreDirection } from "@workshop/shared/games";
import { and, eq } from "drizzle-orm";
import {
  type DbGame,
  gameDirectionRequests,
  gameDirectionRevisions,
  gameScores,
  games,
} from "../db/schema.js";
import { normalizeScoreDirection } from "./gameCatalog.js";
import { rankEntries } from "./ranking.js";
import type { DbClient } from "./sql.js";

interface DirectionPlan {
  from: GameScoreDirection;
  to: GameScoreDirection;
  /** Users waiting for a second vote on a direction; cleared by the change. */
  pendingRequests: number;
  /** Days with at least two scores — the boards a direction can reorder. */
  contestedDays: number;
  /** Of those, the days whose winner(s) the change would replace. */
  daysWinnerChanges: number;
}

function winners(
  entries: { userId: string; scoreValue: number | null; parseStatus?: string }[],
  direction: GameScoreDirection,
): string {
  return rankEntries(entries, direction)
    .filter((e) => e.rank === 1)
    .map((e) => e.userId)
    .sort()
    .join(",");
}

/** What setting `to` would change. Read-only. */
export async function planDirectionChange(
  db: DbClient,
  game: Pick<DbGame, "id" | "scoreDirection">,
  to: GameScoreDirection,
): Promise<DirectionPlan> {
  const from = normalizeScoreDirection(game.scoreDirection);
  const pending = await db
    .select({ userId: gameDirectionRequests.userId })
    .from(gameDirectionRequests)
    .where(eq(gameDirectionRequests.gameId, game.id));
  const scores = await db
    .select({
      userId: gameScores.userId,
      periodKey: gameScores.periodKey,
      scoreValue: gameScores.scoreValue,
      parseStatus: gameScores.parseStatus,
    })
    .from(gameScores)
    .where(eq(gameScores.gameId, game.id));

  const byDay = new Map<
    string,
    { userId: string; scoreValue: number | null; parseStatus?: string }[]
  >();
  for (const s of scores) {
    const day = byDay.get(s.periodKey) ?? [];
    day.push({
      userId: s.userId,
      scoreValue: s.scoreValue === null ? null : Number(s.scoreValue),
      ...(s.parseStatus === null ? {} : { parseStatus: s.parseStatus }),
    });
    byDay.set(s.periodKey, day);
  }
  let contestedDays = 0;
  let daysWinnerChanges = 0;
  for (const day of byDay.values()) {
    if (day.filter((e) => e.scoreValue !== null).length < 2) continue;
    contestedDays += 1;
    if (winners(day, from) !== winners(day, to)) daysWinnerChanges += 1;
  }
  return { from, to, pendingRequests: pending.length, contestedDays, daysWinnerChanges };
}

/**
 * Set the direction and record the revision, in one transaction. Writes only
 * if the game still has the direction the plan was made from; otherwise it
 * returns `stale: true` and writes nothing. Pending two-user requests are
 * cleared (they were votes about the old state), and the game is left with no
 * setter: an operator's correction is not one user's to flip back alone.
 */
export async function applyDirectionChange(
  db: DbClient,
  input: {
    gameId: string;
    from: GameScoreDirection;
    to: GameScoreDirection;
    authoredBy: string;
    note: string;
  },
): Promise<{ stale: true } | { stale: false; revisionId: string; clearedRequests: number }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(games)
      .set({ scoreDirection: input.to, directionSetBy: null })
      .where(and(eq(games.id, input.gameId), eq(games.scoreDirection, input.from)))
      .returning({ id: games.id });
    if (updated.length === 0) return { stale: true as const };
    const [revision] = await tx
      .insert(gameDirectionRevisions)
      .values({
        gameId: input.gameId,
        fromDirection: input.from,
        toDirection: input.to,
        authoredBy: input.authoredBy,
        note: input.note,
      })
      .returning({ id: gameDirectionRevisions.id });
    if (!revision) throw new Error("direction revision was not recorded");
    const cleared = await tx
      .delete(gameDirectionRequests)
      .where(eq(gameDirectionRequests.gameId, input.gameId))
      .returning({ userId: gameDirectionRequests.userId });
    return { stale: false as const, revisionId: revision.id, clearedRequests: cleared.length };
  });
}
