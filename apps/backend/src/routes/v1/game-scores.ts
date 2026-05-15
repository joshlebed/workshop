import type {
  GameLeaderboardEntry,
  GameLeaderboardResponse,
  GameScore,
  ListGameScoresResponse,
} from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbGameScore, gameScores, items, lists, users } from "../../db/schema.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireItemMember, requireListMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";

/**
 * Routes for the games list type's per-day score buckets.
 *
 * Mounted twice in `app.ts`:
 *   - `/v1/items/:id/scores`         — single-game leaderboard + paste/clear
 *   - `/v1/lists/:id/game-scores`    — every game on the list, one date
 *
 * `date` is always a YYYY-MM-DD string in the **submitter's locale** at the
 * time of paste — same definition each game uses to decide which day a play
 * belongs to.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const scoreTextSchema = z.string().min(1, "score required").max(2000, "score too long");

const upsertScoreSchema = z.object({
  date: dateSchema,
  score: scoreTextSchema,
});

function toScoreShape(s: DbGameScore): GameScore {
  return {
    itemId: s.itemId,
    userId: s.userId,
    date: s.date,
    score: s.score,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Item-id-scoped score routes — mounted at `/v1/items`. The item-id-scoped
 * router in `items.ts` uses the same root path; we register the scores
 * sub-paths on a separate Hono so neither file has to reach across modules.
 */
export const itemScoreRoutes = new Hono();
itemScoreRoutes.use("*", requireAuth);

async function assertGameItem(
  c: import("hono").Context,
  itemId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const db = getDb();
  const [row] = await db
    .select({ type: items.type })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row) {
    return { ok: false, response: err(c, "NOT_FOUND", "item not found") };
  }
  if (row.type !== "game") {
    return {
      ok: false,
      response: err(c, "VALIDATION", "scores only supported on game items"),
    };
  }
  return { ok: true };
}

itemScoreRoutes.put(
  "/:id/scores",
  requireItemMember,
  rateLimit({
    family: "v1.game-scores.upsert",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");

    const guard = await assertGameItem(c, itemId);
    if (!guard.ok) return guard.response;

    const parsed = await parseJsonBody(c, upsertScoreSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(gameScores)
      .values({
        itemId,
        userId,
        date: parsed.data.date,
        score: parsed.data.score,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [gameScores.itemId, gameScores.userId, gameScores.date],
        set: {
          score: parsed.data.score,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) return err(c, "INTERNAL", "score upsert returned no row");

    return ok(c, { score: toScoreShape(row) });
  },
);

itemScoreRoutes.delete("/:id/scores", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const guard = await assertGameItem(c, itemId);
  if (!guard.ok) return guard.response;

  const queryDate = c.req.query("date");
  const dateParsed = dateSchema.safeParse(queryDate ?? "");
  if (!dateParsed.success) {
    return err(c, "VALIDATION", "date query param required (YYYY-MM-DD)");
  }

  const db = getDb();
  await db
    .delete(gameScores)
    .where(
      and(
        eq(gameScores.itemId, itemId),
        eq(gameScores.userId, userId),
        eq(gameScores.date, dateParsed.data),
      ),
    );
  return ok(c, { ok: true });
});

itemScoreRoutes.get("/:id/scores", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const guard = await assertGameItem(c, itemId);
  if (!guard.ok) return guard.response;

  const queryDate = c.req.query("date");
  const dateParsed = dateSchema.safeParse(queryDate ?? "");
  if (!dateParsed.success) {
    return err(c, "VALIDATION", "date query param required (YYYY-MM-DD)");
  }

  const db = getDb();
  // Fetch list_id so we can look up every member, then left-join in the score
  // for this date so members without a play still surface in the leaderboard.
  const [parent] = await db
    .select({ listId: items.listId })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!parent) return err(c, "NOT_FOUND", "item not found");

  const rows = await executeRows<{
    user_id: string;
    display_name: string | null;
    score: string | null;
    updated_at: Date | string | null;
  }>(
    db,
    sql`
      SELECT
        m.user_id,
        u.display_name,
        s.score,
        s.updated_at
      FROM list_members m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN game_scores s
        ON s.item_id = ${itemId}
        AND s.user_id = m.user_id
        AND s.date = ${dateParsed.data}
      WHERE m.list_id = ${parent.listId}
      ORDER BY (s.updated_at IS NULL), s.updated_at DESC, COALESCE(u.display_name, '')
    `,
  );

  const entries: GameLeaderboardEntry[] = rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    score: r.score,
    updatedAt: toIsoOrNull(r.updated_at),
  }));

  const response: GameLeaderboardResponse = {
    itemId,
    date: dateParsed.data,
    entries,
  };
  return ok(c, response);
});

/**
 * List-scoped: every game on the list × the requested date, in one round-trip.
 * Mounted at `/v1/lists`.
 */
export const listGameScoresRoutes = new Hono();
listGameScoresRoutes.use("*", requireAuth);

listGameScoresRoutes.get("/:id/game-scores", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const queryDate = c.req.query("date");
  const dateParsed = dateSchema.safeParse(queryDate ?? "");
  if (!dateParsed.success) {
    return err(c, "VALIDATION", "date query param required (YYYY-MM-DD)");
  }

  const db = getDb();
  // Verify the list is a game list — otherwise empty response is misleading.
  const [parent] = await db
    .select({ type: lists.type })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!parent) return err(c, "NOT_FOUND", "list not found");
  if (parent.type !== "game") {
    return err(c, "VALIDATION", "game-scores only supported on game lists");
  }

  // Fetch all scores for any item on this list for the requested date,
  // joined with the submitter's display name.
  const rows = await db
    .select({
      itemId: gameScores.itemId,
      userId: gameScores.userId,
      score: gameScores.score,
      updatedAt: gameScores.updatedAt,
      displayName: users.displayName,
    })
    .from(gameScores)
    .innerJoin(items, eq(items.id, gameScores.itemId))
    .leftJoin(users, eq(users.id, gameScores.userId))
    .where(and(eq(items.listId, listId), eq(gameScores.date, dateParsed.data)));

  const scoresByItem: Record<string, GameLeaderboardEntry[]> = {};
  for (const r of rows) {
    const list = scoresByItem[r.itemId] ?? [];
    list.push({
      userId: r.userId,
      displayName: r.displayName,
      score: r.score,
      updatedAt: toIsoString(r.updatedAt),
    });
    scoresByItem[r.itemId] = list;
  }

  const response: ListGameScoresResponse = {
    date: dateParsed.data,
    scoresByItem,
  };
  return ok(c, response);
});
