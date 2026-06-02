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
import { matchGameScoreRegex } from "../../lib/gameScoreRegex.js";
import { logger } from "../../lib/logger.js";
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

export const __test = {
  periodKeySchema,
  scoreRawSchema,
  upsertScoreSchema,
  tryParseScoreValue,
  assignRanks,
};

/**
 * Pulls a numeric score out of pasted share text.
 *
 * - When `pattern` is provided (the per-item `score_regex`), we use it
 *   case-insensitively. If the pattern has a capture group, we read group 1;
 *   otherwise we read the full match. This is the path most game items take
 *   once the backfill is in.
 * - Without a pattern, we fall back to "first number anywhere in the text"
 *   for legacy items + items the backfill didn't recognize. That's wrong for
 *   most share formats (it grabs the date, the puzzle number, etc.), but
 *   matches existing behavior and never crashes.
 * - Returns null on invalid regex or no match.
 */
function tryParseScoreValue(raw: string, pattern: string | null = null): number | null {
  if (pattern && pattern.length > 0) {
    try {
      const re = new RegExp(pattern, "i");
      const match = raw.match(re);
      if (match) {
        const captured = match[1] ?? match[0];
        const n = Number(captured);
        if (Number.isFinite(n)) return n;
      }
      return null;
    } catch {
      // Bad regex stored on the item — fall through to default behavior so we
      // don't 500. The backfill validates patterns before writing them.
    }
  }
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

function normalizeDirection(value: string | null | undefined): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

export const itemScoreRoutes = new Hono();
itemScoreRoutes.use("*", requireAuth);

interface ItemScoreContext {
  listId: string;
  modules: string[];
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
    scoreRegex: row.scoreRegex,
    scoreDirection: normalizeDirection(row.scoreDirection),
    title: row.title,
    url: row.url,
    siteName: typeof content.siteName === "string" ? content.siteName : null,
    sourceId: typeof content.sourceId === "string" ? content.sourceId : null,
  };
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
    // Self-heal a missing score_regex: a leaderboard game created after the
    // one-time backfill has no regex, so the "first number anywhere" fallback
    // would store junk (e.g. the `dailytens.com/?ref=<id>` referral id) as the
    // score. Detect the game from the item's fields, persist the regex so the
    // ranking read path + future posts use it, and parse with it now.
    let scoreRegex = ctx?.scoreRegex ?? null;
    if (!scoreRegex && ctx) {
      const detected = matchGameScoreRegex(ctx);
      if (detected) {
        scoreRegex = detected.scoreRegex;
        await db
          .update(items)
          .set({ scoreRegex: detected.scoreRegex, scoreDirection: detected.scoreDirection })
          .where(eq(items.id, itemId));
      }
    }
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
  const ctx = await getItemScoreContext(itemId);
  const gate = requireModule(c, ctx?.modules ?? [], "leaderboard");
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
  const direction = ctx.scoreDirection;
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
  const entries: LeaderboardEntry[] = ctx.scoreRegex
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

  const rows = await db
    .select({
      itemId: itemScores.itemId,
      userId: itemScores.userId,
      scoreRaw: itemScores.scoreRaw,
      scoreValue: itemScores.scoreValue,
      updatedAt: itemScores.updatedAt,
      displayName: users.displayName,
      scoreRegex: items.scoreRegex,
      scoreDirection: items.scoreDirection,
    })
    .from(itemScores)
    .innerJoin(items, and(eq(items.id, itemScores.itemId), isNull(items.archivedAt)))
    .leftJoin(users, eq(users.id, itemScores.userId))
    .where(and(eq(items.listId, listId), eq(itemScores.periodKey, parsed.data)));

  // Group rows by item so we can rank each game's entries with that item's
  // direction. Items without a regex (no reliable score parse) get rank: null.
  const byItem = new Map<
    string,
    { direction: "asc" | "desc"; regex: string | null; entries: LeaderboardEntry[] }
  >();
  for (const r of rows) {
    const existing = byItem.get(r.itemId) ?? {
      direction: normalizeDirection(r.scoreDirection),
      regex: r.scoreRegex,
      entries: [] as LeaderboardEntry[],
    };
    existing.entries.push({
      userId: r.userId,
      displayName: r.displayName,
      scoreRaw: r.scoreRaw,
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
      updatedAt: toIsoString(r.updatedAt),
      rank: null,
    });
    byItem.set(r.itemId, existing);
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
