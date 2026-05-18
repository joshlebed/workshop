import type {
  ItemScore,
  LeaderboardEntry,
  LeaderboardResponse,
  ListScoresResponse,
} from "@workshop/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { itemScores, items, lists, users } from "../../db/schema.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import { requireModule } from "../../lib/moduleGate.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireItemMember, requireListMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const periodKeySchema = z
  .string()
  .min(1, "periodKey required")
  .max(64, "periodKey too long")
  .refine((s) => /^[A-Za-z0-9_\-:.]+$/.test(s), "periodKey contains invalid characters");

const scoreRawSchema = z.string().min(1, "scoreRaw required").max(2000, "scoreRaw too long");

const upsertScoreSchema = z.object({
  periodKey: periodKeySchema,
  scoreRaw: scoreRawSchema,
});

function tryParseScoreValue(raw: string): number | null {
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function toScoreShape(row: {
  itemId: string;
  userId: string;
  periodKey: string;
  scoreValue: string | null;
  scoreRaw: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): ItemScore {
  return {
    itemId: row.itemId,
    userId: row.userId,
    periodKey: row.periodKey,
    scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
    scoreRaw: row.scoreRaw,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export const itemScoreRoutes = new Hono();
itemScoreRoutes.use("*", requireAuth);

async function getParentModulesForItem(itemId: string): Promise<string[]> {
  const db = getDb();
  const [row] = await db
    .select({ modules: lists.modules })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .where(eq(items.id, itemId))
    .limit(1);
  return (row?.modules ?? []) as string[];
}

itemScoreRoutes.put(
  "/:id/scores",
  requireItemMember,
  rateLimit({
    family: "v1.scores.upsert",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");
    const gate = requireModule(c, await getParentModulesForItem(itemId), "leaderboard");
    if (gate) return gate;

    const parsed = await parseJsonBody(c, upsertScoreSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const now = new Date();
    const value = tryParseScoreValue(parsed.data.scoreRaw);
    const [row] = await db
      .insert(itemScores)
      .values({
        itemId,
        userId,
        periodKey: parsed.data.periodKey,
        scoreRaw: parsed.data.scoreRaw,
        scoreValue: value === null ? null : String(value),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [itemScores.itemId, itemScores.userId, itemScores.periodKey],
        set: {
          scoreRaw: parsed.data.scoreRaw,
          scoreValue: value === null ? null : String(value),
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
  const gate = requireModule(c, await getParentModulesForItem(itemId), "leaderboard");
  if (gate) return gate;

  const periodKey = c.req.query("periodKey") ?? c.req.query("date");
  const parsed = periodKeySchema.safeParse(periodKey ?? "");
  if (!parsed.success) return err(c, "VALIDATION", "periodKey query param required");

  const db = getDb();
  await db
    .delete(itemScores)
    .where(
      and(
        eq(itemScores.itemId, itemId),
        eq(itemScores.userId, userId),
        eq(itemScores.periodKey, parsed.data),
      ),
    );
  return ok(c, { ok: true });
});

itemScoreRoutes.get("/:id/scores", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const gate = requireModule(c, await getParentModulesForItem(itemId), "leaderboard");
  if (gate) return gate;

  const periodKey = c.req.query("periodKey") ?? c.req.query("date");
  const parsed = periodKeySchema.safeParse(periodKey ?? "");
  if (!parsed.success) return err(c, "VALIDATION", "periodKey query param required");

  const db = getDb();
  const [parent] = await db
    .select({ listId: items.listId })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.archivedAt)))
    .limit(1);
  if (!parent) return err(c, "NOT_FOUND", "item not found");

  const rows = await executeRows<{
    user_id: string;
    display_name: string | null;
    score_raw: string | null;
    score_value: string | null;
    updated_at: Date | string | null;
  }>(
    db,
    sql`
      SELECT
        m.user_id,
        u.display_name,
        s.score_raw,
        s.score_value,
        s.updated_at
      FROM list_members m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN item_scores s
        ON s.item_id = ${itemId}
        AND s.user_id = m.user_id
        AND s.period_key = ${parsed.data}
      WHERE m.list_id = ${parent.listId}
      ORDER BY (s.updated_at IS NULL), s.updated_at DESC, COALESCE(u.display_name, '')
    `,
  );

  const entries: LeaderboardEntry[] = rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    scoreRaw: r.score_raw,
    scoreValue: r.score_value === null ? null : Number(r.score_value),
    updatedAt: toIsoOrNull(r.updated_at),
  }));

  const response: LeaderboardResponse = {
    itemId,
    periodKey: parsed.data,
    entries,
  };
  return ok(c, response);
});

export const listScoresRoutes = new Hono();
listScoresRoutes.use("*", requireAuth);

listScoresRoutes.get("/:id/scores", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const periodKey = c.req.query("periodKey") ?? c.req.query("date");
  const parsed = periodKeySchema.safeParse(periodKey ?? "");
  if (!parsed.success) return err(c, "VALIDATION", "periodKey query param required");

  const db = getDb();
  const [parent] = await db
    .select({ modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!parent) return err(c, "NOT_FOUND", "list not found");
  const gate = requireModule(c, parent.modules ?? [], "leaderboard");
  if (gate) return gate;

  const rows = await db
    .select({
      itemId: itemScores.itemId,
      userId: itemScores.userId,
      scoreRaw: itemScores.scoreRaw,
      scoreValue: itemScores.scoreValue,
      updatedAt: itemScores.updatedAt,
      displayName: users.displayName,
    })
    .from(itemScores)
    .innerJoin(items, and(eq(items.id, itemScores.itemId), isNull(items.archivedAt)))
    .leftJoin(users, eq(users.id, itemScores.userId))
    .where(and(eq(items.listId, listId), eq(itemScores.periodKey, parsed.data)));

  const scoresByItem: Record<string, LeaderboardEntry[]> = {};
  for (const r of rows) {
    const list = scoresByItem[r.itemId] ?? [];
    list.push({
      userId: r.userId,
      displayName: r.displayName,
      scoreRaw: r.scoreRaw,
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
      updatedAt: toIsoString(r.updatedAt),
    });
    scoresByItem[r.itemId] = list;
  }

  const response: ListScoresResponse = {
    periodKey: parsed.data,
    scoresByItem,
  };
  return ok(c, response);
});
