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
import { gameScores, itemScores, items, lists } from "../../db/schema.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import {
  catalogEntryForKey,
  ensureLeaderboardItemGame,
  normalizeScoreDirection,
  parseScoreValue as tryParseScoreValue,
} from "../../lib/gameCatalog.js";
import { logger } from "../../lib/logger.js";
import { requireModule } from "../../lib/moduleGate.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import { addToMyGames } from "../../lib/userGames.js";
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

export const __test = {
  periodKeySchema,
  scoreRawSchema,
  upsertScoreSchema,
  tryParseScoreValue,
  assignRanks,
};

function toScoreShape(
  itemId: string,
  row: {
    userId: string;
    periodKey: string;
    scoreValue: string | null;
    scoreRaw: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
): ItemScore {
  return {
    itemId,
    userId: row.userId,
    periodKey: row.periodKey,
    scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
    scoreRaw: row.scoreRaw,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

/**
 * Assigns "standard competition" ranks (1, 2, 2, 4) to entries that have a
 * numeric score. Direction controls comparison: 'desc' = bigger is better,
 * 'asc' = smaller is better. Entries without a numeric score get `rank: null`.
 * Pure helper — no DB access — exported for unit testing.
 */
function assignRanks<T extends { scoreValue: number | null }>(
  entries: readonly T[],
  direction: "asc" | "desc",
): (T & { rank: number | null })[] {
  const played: { entry: T; idx: number }[] = [];
  const unplayed: { entry: T; idx: number }[] = [];
  entries.forEach((entry, idx) => {
    if (typeof entry.scoreValue === "number" && Number.isFinite(entry.scoreValue)) {
      played.push({ entry, idx });
    } else {
      unplayed.push({ entry, idx });
    }
  });
  played.sort((a, b) => {
    const av = a.entry.scoreValue as number;
    const bv = b.entry.scoreValue as number;
    return direction === "desc" ? bv - av : av - bv;
  });
  const ranked: { idx: number; out: T & { rank: number | null } }[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  played.forEach(({ entry, idx }, i) => {
    const v = entry.scoreValue as number;
    const rank = lastValue !== null && v === lastValue ? lastRank : i + 1;
    lastValue = v;
    lastRank = rank;
    ranked.push({ idx, out: { ...entry, rank } });
  });
  unplayed.forEach(({ entry, idx }) => {
    ranked.push({ idx, out: { ...entry, rank: null } });
  });
  // Restore caller order so we don't disturb the SQL ORDER BY (played first
  // by score, then unplayed by display name).
  ranked.sort((a, b) => a.idx - b.idx);
  return ranked.map((r) => r.out);
}

export const itemScoreRoutes = new Hono();
itemScoreRoutes.use("*", requireAuth);

interface ItemScoreContext {
  listId: string;
  modules: string[];
  gameId: string | null;
  scoreRegex: string | null;
  scoreDirection: "asc" | "desc";
  // Searchable fields used to self-heal a missing `scoreRegex` on first
  // score post (see the upsert handler).
  title: string;
  url: string | null;
  siteName: string | null;
  sourceId: string | null;
}

async function getItemScoreContext(itemId: string): Promise<ItemScoreContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      listId: items.listId,
      modules: lists.modules,
      gameId: items.gameId,
      scoreRegex: items.scoreRegex,
      scoreDirection: items.scoreDirection,
      title: items.title,
      url: items.url,
      content: items.content,
    })
    .from(items)
    .innerJoin(lists, eq(lists.id, items.listId))
    .where(and(eq(items.id, itemId), isNull(items.archivedAt)))
    .limit(1);
  if (!row) return null;
  const content = (row.content ?? {}) as Record<string, unknown>;
  return {
    listId: row.listId,
    modules: (row.modules ?? []) as string[],
    gameId: row.gameId,
    scoreRegex: row.scoreRegex,
    scoreDirection: normalizeScoreDirection(row.scoreDirection),
    title: row.title,
    url: row.url,
    siteName: typeof content.siteName === "string" ? content.siteName : null,
    sourceId: typeof content.sourceId === "string" ? content.sourceId : null,
  };
}

async function resolveItemGameMapping(itemId: string, ctx: ItemScoreContext) {
  return ensureLeaderboardItemGame({
    itemId,
    gameId: ctx.gameId,
    scoreRegex: ctx.scoreRegex,
    scoreDirection: ctx.scoreDirection,
    title: ctx.title,
    url: ctx.url,
    siteName: ctx.siteName,
    sourceId: ctx.sourceId,
  });
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
    const ctx = await getItemScoreContext(itemId);
    const gate = requireModule(c, ctx?.modules ?? [], "leaderboard");
    if (gate) return gate;

    const parsed = await parseJsonBody(c, upsertScoreSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const now = new Date();
    const mapping = ctx ? await resolveItemGameMapping(itemId, ctx) : null;
    const scoreRegex = mapping?.scoreRegex ?? ctx?.scoreRegex ?? null;
    const value = tryParseScoreValue(parsed.data.scoreRaw, scoreRegex);

    // Diagnostic: capture the shape of what actually reached us so a scoreless
    // "Played" row (the share extension handed the client only a game's referral
    // URL, dropping the result text) is debuggable from the server. One line per
    // post; filter `score_upsert_debug` in CloudWatch. `url_only` mirrors the
    // client's `isResultlessShare` heuristic (strips to nothing after removing
    // URLs + hashtag-only lines).
    const rawStripped = parsed.data.scoreRaw
      .split(/\r?\n/)
      .map((line) => line.replace(/\bhttps?:\/\/\S+/gi, "").trim())
      .filter((line) => line.length > 0 && !/^#\S+$/.test(line))
      .join("\n");
    logger.info("score_upsert_debug", {
      kind: "score_debug",
      event: "score_upsert",
      user_id: userId,
      item_id: itemId,
      period_key: parsed.data.periodKey,
      raw_len: parsed.data.scoreRaw.length,
      raw_preview: parsed.data.scoreRaw.slice(0, 200),
      has_url: /\bhttps?:\/\//i.test(parsed.data.scoreRaw),
      has_grid_emoji: /[🏆❌🟩🟨🟧🟥⬛⬜🔵🟢🟡]/u.test(parsed.data.scoreRaw),
      url_only: rawStripped.length === 0,
      score_regex: scoreRegex,
      score_value: value,
    });

    if (mapping) {
      const [row] = await db
        .insert(gameScores)
        .values({
          gameId: mapping.game.id,
          userId,
          periodKey: parsed.data.periodKey,
          scoreRaw: parsed.data.scoreRaw,
          scoreValue: value === null ? null : String(value),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [gameScores.gameId, gameScores.userId, gameScores.periodKey],
          set: {
            scoreRaw: parsed.data.scoreRaw,
            scoreValue: value === null ? null : String(value),
            updatedAt: now,
          },
        })
        .returning();
      if (!row) return err(c, "INTERNAL", "score upsert returned no row");
      await addToMyGames(userId, mapping.game.id, db);
      return ok(c, { score: toScoreShape(itemId, row) });
    }

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
    return ok(c, { score: toScoreShape(itemId, row) });
  },
);

itemScoreRoutes.delete("/:id/scores", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const ctx = await getItemScoreContext(itemId);
  const gate = requireModule(c, ctx?.modules ?? [], "leaderboard");
  if (gate) return gate;

  const periodKey = c.req.query("periodKey") ?? c.req.query("date");
  const parsed = periodKeySchema.safeParse(periodKey ?? "");
  if (!parsed.success) return err(c, "VALIDATION", "periodKey query param required");

  const db = getDb();
  const mapping = ctx ? await resolveItemGameMapping(itemId, ctx) : null;
  if (mapping) {
    await db
      .delete(gameScores)
      .where(
        and(
          eq(gameScores.gameId, mapping.game.id),
          eq(gameScores.userId, userId),
          eq(gameScores.periodKey, parsed.data),
        ),
      );
    return ok(c, { ok: true });
  }

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
  const ctx = await getItemScoreContext(itemId);
  const gate = requireModule(c, ctx?.modules ?? [], "leaderboard");
  if (gate) return gate;

  const periodKey = c.req.query("periodKey") ?? c.req.query("date");
  const parsed = periodKeySchema.safeParse(periodKey ?? "");
  if (!parsed.success) return err(c, "VALIDATION", "periodKey query param required");
  if (!ctx) return err(c, "NOT_FOUND", "item not found");

  const db = getDb();
  // Sort: players who posted a score come first, ranked by score_value in
  // the item's direction; players who haven't played come last, by name.
  const mapping = await resolveItemGameMapping(itemId, ctx);
  const direction = mapping?.scoreDirection ?? ctx.scoreDirection;
  const regex = mapping?.scoreRegex ?? ctx.scoreRegex;
  const scoreJoin = mapping
    ? sql`
      LEFT JOIN game_scores s
        ON s.game_id = ${mapping.game.id}
        AND s.user_id = m.user_id
        AND s.period_key = ${parsed.data}
    `
    : sql`
      LEFT JOIN item_scores s
        ON s.item_id = ${itemId}
        AND s.user_id = m.user_id
        AND s.period_key = ${parsed.data}
    `;
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
      ${scoreJoin}
      WHERE m.list_id = ${ctx.listId}
      ORDER BY
        (s.score_value IS NULL),
        ${direction === "desc" ? sql`s.score_value DESC` : sql`s.score_value ASC`},
        (s.updated_at IS NULL),
        s.updated_at DESC,
        COALESCE(u.display_name, '')
    `,
  );

  const baseEntries = rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    scoreRaw: r.score_raw,
    scoreValue: r.score_value === null ? null : Number(r.score_value),
    updatedAt: toIsoOrNull(r.updated_at),
  }));
  const entries: LeaderboardEntry[] = regex
    ? assignRanks(baseEntries, direction)
    : baseEntries.map((e) => ({ ...e, rank: null }));

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

  const rows = await executeRows<{
    item_id: string;
    user_id: string;
    score_raw: string;
    score_value: string | null;
    updated_at: Date | string;
    display_name: string | null;
    score_regex: string | null;
    score_direction: string | null;
    game_key: string | null;
    game_score_direction: string | null;
  }>(
    db,
    sql`
      SELECT
        i.id AS item_id,
        s.user_id,
        s.score_raw,
        s.score_value,
        s.updated_at,
        u.display_name,
        i.score_regex,
        i.score_direction,
        g.game_key,
        g.score_direction AS game_score_direction
      FROM items i
      INNER JOIN game_scores s
        ON s.game_id = i.game_id
        AND s.period_key = ${parsed.data}
      LEFT JOIN games g ON g.id = i.game_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE i.list_id = ${listId}
        AND i.archived_at IS NULL
        AND i.game_id IS NOT NULL

      UNION ALL

      SELECT
        i.id AS item_id,
        s.user_id,
        s.score_raw,
        s.score_value,
        s.updated_at,
        u.display_name,
        i.score_regex,
        i.score_direction,
        NULL::text AS game_key,
        NULL::text AS game_score_direction
      FROM item_scores s
      INNER JOIN items i
        ON i.id = s.item_id
        AND i.archived_at IS NULL
        AND i.game_id IS NULL
      LEFT JOIN users u ON u.id = s.user_id
      WHERE i.list_id = ${listId}
        AND s.period_key = ${parsed.data}
    `,
  );

  // Group rows by item so we can rank each game's entries with that item's
  // direction. Items without a regex (no reliable score parse) get rank: null.
  const byItem = new Map<
    string,
    { direction: "asc" | "desc"; regex: string | null; entries: LeaderboardEntry[] }
  >();
  for (const r of rows) {
    const catalog = catalogEntryForKey(r.game_key);
    const existing = byItem.get(r.item_id) ?? {
      direction:
        catalog?.scoreDirection ??
        normalizeScoreDirection(r.game_score_direction ?? r.score_direction),
      regex: catalog?.scoreRegex ?? r.score_regex,
      entries: [] as LeaderboardEntry[],
    };
    existing.entries.push({
      userId: r.user_id,
      displayName: r.display_name,
      scoreRaw: r.score_raw,
      scoreValue: r.score_value === null ? null : Number(r.score_value),
      updatedAt: toIsoString(r.updated_at),
      rank: null,
    });
    byItem.set(r.item_id, existing);
  }

  const scoresByItem: Record<string, LeaderboardEntry[]> = {};
  for (const [itemId, group] of byItem) {
    scoresByItem[itemId] = group.regex
      ? assignRanks(group.entries, group.direction)
      : group.entries;
  }

  const response: ListScoresResponse = {
    periodKey: parsed.data,
    scoresByItem,
  };
  return ok(c, response);
});
