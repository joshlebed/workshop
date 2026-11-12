// Sparse-integer position allocator for `items.position` (§3.4 of the
// redesign). Spacing of 1024 between siblings gives ~10⁹ headroom before any
// rebalance is needed; collisions trigger an eager rebalance of the list's
// ordered section in a single SQL statement.

import { and, eq, isNull, sql } from "drizzle-orm";
import { items } from "../db/schema.js";
import type { DbClient } from "./sql.js";

export const POSITION_SPACING = 1024;

/**
 * Trigger a normalizing rebalance when `MIN(position) < REBALANCE_FLOOR`.
 * The "move to top" operation forever decrements positions; in practice
 * the rebalance never fires under normal usage, but it bounds the long
 * tail before positions become inscrutable in the DB (§3.8 of the
 * redesign).
 */
export const REBALANCE_FLOOR = -1_000_000_000;

interface MoveArgs {
  listId: string;
  itemId: string;
  beforeItemId?: string | null;
  afterItemId?: string | null;
  /** With no neighbours: `true` → append to the ordered section; else demote. */
  ordered?: boolean;
  db: DbClient;
}

interface MoveResult {
  position: number | null;
  rebalanced: boolean;
}

/**
 * Compute the next position for `itemId`, then UPDATE the row. Returns the
 * new position (null when demoting to unordered) plus whether the list's
 * ordered section was rebalanced as a side effect.
 *
 * - both null            → demote (position = NULL) — unless `ordered` is
 *                          true, which appends to the end of the ordered
 *                          section instead (how the first item of an empty
 *                          Ranked section gets a position)
 * - only beforeItemId    → place just after `before`
 * - only afterItemId     → place just before `after`
 * - both                 → place between them, rebalancing on collision
 */
export async function moveItemPosition(args: MoveArgs): Promise<MoveResult> {
  const { listId, itemId, beforeItemId, afterItemId, ordered = false, db } = args;

  if (!beforeItemId && !afterItemId && ordered) {
    const position = await appendPosition(listId, db);
    await db.update(items).set({ position, updatedAt: new Date() }).where(eq(items.id, itemId));
    return { position, rebalanced: false };
  }

  if (!beforeItemId && !afterItemId) {
    await db
      .update(items)
      .set({ position: null, updatedAt: new Date() })
      .where(eq(items.id, itemId));
    return { position: null, rebalanced: false };
  }

  const attempt = async (): Promise<number | null> => {
    const beforePos = beforeItemId ? await lookupPosition(db, beforeItemId) : null;
    const afterPos = afterItemId ? await lookupPosition(db, afterItemId) : null;
    let lower: number | null;
    let upper: number | null;
    if (beforePos !== null && afterPos !== null) {
      lower = Math.min(beforePos, afterPos);
      upper = Math.max(beforePos, afterPos);
    } else if (beforePos !== null) {
      lower = beforePos;
      upper = await neighborPosition(db, listId, "above", beforePos);
    } else if (afterPos !== null) {
      lower = await neighborPosition(db, listId, "below", afterPos);
      upper = afterPos;
    } else {
      return null;
    }
    return computeBetween(lower, upper);
  };

  let newPos = await attempt();
  let rebalanced = false;
  if (newPos === null) {
    await rebalanceList(listId, db);
    rebalanced = true;
    newPos = await attempt();
  }
  if (newPos === null) {
    // Fallback: append to the end.
    newPos = await appendPosition(listId, db);
  }
  await db
    .update(items)
    .set({ position: newPos, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  // §3.8: opportunistic rebalance when "move-to-top forever" has driven the
  // list's MIN(position) below the floor. Cheap to check (single-row index
  // probe) and amortizes across many moves before firing.
  if (!rebalanced) {
    const min = await minPositionForList(db, listId);
    if (shouldRebalanceForOverflow(min)) {
      await rebalanceList(listId, db);
      rebalanced = true;
      newPos = await lookupPosition(db, itemId);
    }
  }

  return { position: newPos, rebalanced };
}

async function minPositionForList(db: DbClient, listId: string): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<number | null>`MIN(position)::int` })
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt), sql`position IS NOT NULL`));
  const min = row?.min;
  if (min === null || min === undefined) return null;
  return Number(min);
}

async function lookupPosition(db: DbClient, id: string): Promise<number | null> {
  const [row] = await db
    .select({ position: items.position })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  return row?.position ?? null;
}

async function neighborPosition(
  db: DbClient,
  listId: string,
  direction: "above" | "below",
  anchor: number,
): Promise<number | null> {
  const cmp = direction === "above" ? sql`position > ${anchor}` : sql`position < ${anchor}`;
  const order = direction === "above" ? sql`position ASC` : sql`position DESC`;
  const rows = await db
    .select({ position: items.position })
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt), sql`position IS NOT NULL`, cmp))
    .orderBy(order)
    .limit(1);
  return rows[0]?.position ?? null;
}

export function computeBetween(lower: number | null, upper: number | null): number | null {
  if (lower === null && upper === null) return POSITION_SPACING;
  if (lower === null && upper !== null) return upper - POSITION_SPACING;
  if (lower !== null && upper === null) return lower + POSITION_SPACING;
  if (upper! - lower! <= 1) return null;
  return Math.floor((lower! + upper!) / 2);
}

/**
 * Returns true when the list's ordered section has drifted into negative
 * territory deep enough to warrant a normalizing rebalance. Callers check
 * this post-move; an opportunistic rebalance keeps the long tail of
 * "move-to-top forever" from producing inscrutable positions in the DB.
 */
export function shouldRebalanceForOverflow(minPosition: number | null): boolean {
  if (minPosition === null) return false;
  return minPosition < REBALANCE_FLOOR;
}

/**
 * Rebalance the list's ordered section to fresh n*1024 spacing. Single SQL
 * statement; runs in milliseconds at Workshop's scale.
 */
async function rebalanceList(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH renumbered AS (
      SELECT id,
             (ROW_NUMBER() OVER (ORDER BY position) * ${POSITION_SPACING})::int AS new_position
      FROM items
      WHERE list_id = ${listId}
        AND position IS NOT NULL
        AND archived_at IS NULL
    )
    UPDATE items
    SET position = renumbered.new_position
    FROM renumbered
    WHERE items.id = renumbered.id
  `);
}

/**
 * Append-to-end allocator used by item creation when the list has the
 * `ranking` module enabled. Returns `MAX(position) + spacing` so the new
 * item sorts at the bottom of the ordered section.
 */
export async function appendPosition(listId: string, db: DbClient): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), 0)::int` })
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt), sql`position IS NOT NULL`));
  return Number(row?.max ?? 0) + POSITION_SPACING;
}

// --- Unranked block order (`items.order_key`, UX pass 2.7) ---------------
//
// The Ranked block is ordered by `position`; everything else that is open
// (every item on a list without the ranking feature) is ordered by
// `order_key`. NULL keys sort first, newest first, so a list nobody has
// dragged keeps its recency order and new items land at the top without the
// create path knowing about keys. The first hand placement on a list
// "materializes" its NULL rows (gives them keys above the current minimum in
// their displayed order), after which the usual sparse-integer midpoint
// arithmetic applies. Keys are list-wide (ranked, done and archived rows keep
// theirs), so a row returning to the block — uncompleted, removed from
// ranking, restored — lands where it was.

/**
 * The display order of a list's unranked block. Shared by
 * `fetchItemsForList` and the materialize/renumber statements here so a
 * hand placement never reshuffles rows it didn't touch. The recency
 * expression is the one the album shelf has always used (`detectedAt` for
 * synced albums, else `created_at`).
 */
export const UNRANKED_ORDER_SQL = sql.raw(
  "order_key ASC NULLS FIRST, COALESCE(content->>'detectedAt', created_at::text) DESC, id ASC",
);

interface UnrankedMoveArgs {
  listId: string;
  itemId: string;
  /** The open row displayed directly above the drop, if any. */
  beforeItemId?: string | null;
  /** The open row displayed directly below the drop, if any. */
  afterItemId?: string | null;
  db: DbClient;
}

interface UnrankedMoveResult {
  orderKey: number;
  rebalanced: boolean;
}

/**
 * Place `itemId` in the unranked block between two neighbours (either may be
 * null: only `before` → just below it, only `after` → just above it, neither
 * → top of the block). Does not touch `position`; the route clears it first
 * when the move takes a row out of the Ranked block.
 */
export async function moveItemUnranked(args: UnrankedMoveArgs): Promise<UnrankedMoveResult> {
  const { listId, itemId, beforeItemId, afterItemId, db } = args;
  await materializeOrderKeys(listId, db);

  const attempt = async (): Promise<number | null> => {
    const beforeKey = beforeItemId ? await lookupOrderKey(db, beforeItemId) : null;
    const afterKey = afterItemId ? await lookupOrderKey(db, afterItemId) : null;
    let lower: number | null;
    let upper: number | null;
    if (beforeKey !== null && afterKey !== null) {
      lower = Math.min(beforeKey, afterKey);
      upper = Math.max(beforeKey, afterKey);
    } else if (beforeKey !== null) {
      lower = beforeKey;
      upper = await neighborOrderKey(db, listId, itemId, "above", beforeKey);
    } else if (afterKey !== null) {
      lower = await neighborOrderKey(db, listId, itemId, "below", afterKey);
      upper = afterKey;
    } else {
      // Top of the block: above the smallest key on the list.
      lower = null;
      upper = await minOrderKey(db, listId, itemId);
    }
    return computeBetween(lower, upper);
  };

  let key = await attempt();
  let rebalanced = false;
  if (key === null) {
    await renumberOrderKeys(listId, db);
    rebalanced = true;
    key = await attempt();
  }
  if (key === null) key = (await minOrderKey(db, listId, itemId)) ?? POSITION_SPACING;
  await db.update(items).set({ orderKey: key, updatedAt: new Date() }).where(eq(items.id, itemId));

  if (!rebalanced && shouldRebalanceForOverflow(await minOrderKey(db, listId, null))) {
    await renumberOrderKeys(listId, db);
    rebalanced = true;
    key = (await lookupOrderKey(db, itemId)) ?? key;
  }
  return { orderKey: key, rebalanced };
}

/**
 * Give every NULL-keyed row on the list a key above the current minimum,
 * preserving their displayed (newest-first) order. A no-op once the list has
 * no NULL keys; new items reintroduce a few at the top.
 */
async function materializeOrderKeys(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH floor AS (
      SELECT COALESCE(MIN(order_key), 0) AS m
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND order_key IS NOT NULL
    ),
    pending AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY ${UNRANKED_ORDER_SQL}) AS rn,
             COUNT(*) OVER () AS n
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND order_key IS NULL
    )
    UPDATE items
    SET order_key = (floor.m - (pending.n - pending.rn + 1) * ${POSITION_SPACING})::int
    FROM pending, floor
    WHERE items.id = pending.id
  `);
}

/** Re-space every keyed row on the list to n*1024 in its current order. */
async function renumberOrderKeys(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH renumbered AS (
      SELECT id,
             (ROW_NUMBER() OVER (ORDER BY ${UNRANKED_ORDER_SQL}) * ${POSITION_SPACING})::int AS k
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL
    )
    UPDATE items
    SET order_key = renumbered.k
    FROM renumbered
    WHERE items.id = renumbered.id
  `);
}

async function lookupOrderKey(db: DbClient, id: string): Promise<number | null> {
  const [row] = await db
    .select({ orderKey: items.orderKey })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  return row?.orderKey ?? null;
}

async function minOrderKey(
  db: DbClient,
  listId: string,
  excludeId: string | null,
): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<number | null>`MIN(order_key)::int` })
    .from(items)
    .where(
      and(
        eq(items.listId, listId),
        isNull(items.archivedAt),
        sql`order_key IS NOT NULL`,
        excludeId ? sql`id <> ${excludeId}` : sql`TRUE`,
      ),
    );
  const min = row?.min;
  return min === null || min === undefined ? null : Number(min);
}

async function neighborOrderKey(
  db: DbClient,
  listId: string,
  excludeId: string,
  direction: "above" | "below",
  anchor: number,
): Promise<number | null> {
  // "above" in key space = the next larger key (the row displayed below).
  const cmp = direction === "above" ? sql`order_key > ${anchor}` : sql`order_key < ${anchor}`;
  const order = direction === "above" ? sql`order_key ASC` : sql`order_key DESC`;
  const rows = await db
    .select({ orderKey: items.orderKey })
    .from(items)
    .where(
      and(
        eq(items.listId, listId),
        isNull(items.archivedAt),
        sql`order_key IS NOT NULL`,
        sql`id <> ${excludeId}`,
        cmp,
      ),
    )
    .orderBy(order)
    .limit(1);
  return rows[0]?.orderKey ?? null;
}
