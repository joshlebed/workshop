// One order per list (docs/list-types.md → "Order"). `items.position` is the
// order of a list's open items: sparse integers, ascending = top, spacing 1024
// so a drop between two neighbours is one midpoint and a collision triggers an
// eager renumber of the list in a single statement.
//
// `position IS NULL` means "not placed yet". On a list with an attached source
// that is the sync inbox ("New from Spotify"): rows a sync brought in that no
// person has moved into the list. Elsewhere NULL rows only exist transiently
// (rows from before the one-order migration, a list whose source was removed
// before any were placed): they read at the top, newest first, and the first
// hand placement on the list gives them positions (`materializePositions`).
//
// Positions are list-wide: done and deleted rows keep theirs, so reopening a
// row or undoing a delete puts it back where it was. `items.order_key` (the
// retired second order) is no longer read or written.

import { and, eq, isNull, sql } from "drizzle-orm";
import { items } from "../db/schema.js";
import type { DbClient } from "./sql.js";

export const POSITION_SPACING = 1024;

/**
 * Trigger a normalizing rebalance when `MIN(position) < REBALANCE_FLOOR`.
 * New items and "move to top" forever decrement positions; in practice the
 * rebalance never fires, but it bounds the long tail before positions become
 * inscrutable (or overflow the int column).
 */
export const REBALANCE_FLOOR = -1_000_000_000;

/**
 * Newest first. The album shelf has always sorted synced rows by when the
 * sync first saw them (`detectedAt`), everything else by `created_at`.
 */
const RECENCY = "COALESCE(content->>'detectedAt', created_at::text) DESC, id ASC";

/** Newest first (the inbox's order, and every tie-break). */
export const RECENCY_ORDER_SQL = sql.raw(RECENCY);

/** The list's order: placed rows top-down, unplaced rows first, newest first. */
export const LIST_ORDER_SQL = sql.raw(`position ASC NULLS FIRST, ${RECENCY}`);

/** `LIST_ORDER_SQL` for rows already read newest first: a stable sort by position, NULLs first. */
export function byPosition(
  a: { position?: number | null },
  b: { position?: number | null },
): number {
  const pa = a.position ?? null;
  const pb = b.position ?? null;
  if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? -1 : 1;
  return pa - pb;
}

export function computeBetween(lower: number | null, upper: number | null): number | null {
  if (lower === null && upper === null) return POSITION_SPACING;
  if (lower === null && upper !== null) return upper - POSITION_SPACING;
  if (lower !== null && upper === null) return lower + POSITION_SPACING;
  if (upper! - lower! <= 1) return null;
  return Math.floor((lower! + upper!) / 2);
}

/**
 * True when the list's positions have drifted deep enough below zero
 * ("add at top" forever) to warrant a normalizing renumber.
 */
export function shouldRebalanceForOverflow(minPosition: number | null): boolean {
  if (minPosition === null) return false;
  return minPosition < REBALANCE_FLOOR;
}

interface PlaceArgs {
  listId: string;
  itemId: string;
  /** The open row displayed directly above the drop, if any. */
  beforeItemId?: string | null;
  /** The open row displayed directly below the drop, if any. */
  afterItemId?: string | null;
  /**
   * The list has an attached source, so a NULL position is the sync inbox and
   * must stay NULL. Without one, NULL rows are materialized first.
   */
  hasSource: boolean;
  db: DbClient;
}

interface PlaceResult {
  position: number;
  rebalanced: boolean;
}

/**
 * Place `itemId` in the list's one order: just below `before`, else just
 * above `after`, else at the top. A neighbour that is not a placed row of the
 * same list (an inbox row, another list's id) is ignored, so a drop beside it
 * still lands. A drop under a filter names the two rows the person saw; the
 * row lands between them, wherever hidden rows sit.
 */
export async function placeItem(args: PlaceArgs): Promise<PlaceResult> {
  const { listId, itemId, db } = args;
  const beforeItemId = args.beforeItemId === itemId ? null : (args.beforeItemId ?? null);
  const afterItemId = args.afterItemId === itemId ? null : (args.afterItemId ?? null);
  if (!args.hasSource) await materializePositions(listId, db);

  const attempt = async (): Promise<number | null> => {
    const beforePos = beforeItemId ? await lookupPosition(db, listId, beforeItemId) : null;
    const afterPos = afterItemId ? await lookupPosition(db, listId, afterItemId) : null;
    let lower: number | null;
    let upper: number | null;
    if (beforePos !== null && afterPos !== null) {
      lower = Math.min(beforePos, afterPos);
      upper = Math.max(beforePos, afterPos);
    } else if (beforePos !== null) {
      lower = beforePos;
      upper = await neighbourPosition(db, listId, itemId, "below", beforePos);
    } else if (afterPos !== null) {
      lower = await neighbourPosition(db, listId, itemId, "above", afterPos);
      upper = afterPos;
    } else {
      lower = null;
      upper = await minPosition(db, listId, itemId);
    }
    return computeBetween(lower, upper);
  };

  let position = await attempt();
  let rebalanced = false;
  if (position === null) {
    await rebalanceList(listId, db);
    rebalanced = true;
    position = await attempt();
  }
  // Still no room (cannot happen after a renumber): the top is always free.
  if (position === null) position = await topPosition(listId, db, itemId);
  await db.update(items).set({ position, updatedAt: new Date() }).where(eq(items.id, itemId));

  if (!rebalanced && shouldRebalanceForOverflow(await minPosition(db, listId, null))) {
    await rebalanceList(listId, db);
    rebalanced = true;
    position = (await lookupPosition(db, listId, itemId)) ?? position;
  }
  return { position, rebalanced };
}

/** The position that puts a row above every other row on the list. */
export async function topPosition(
  listId: string,
  db: DbClient,
  excludeId: string | null = null,
): Promise<number> {
  return computeBetween(null, await minPosition(db, listId, excludeId)) ?? POSITION_SPACING;
}

/**
 * `count` ascending positions above every row on the list, for rows that
 * should land at the top in the order given (bulk paste keeps the pasted
 * order). Renumbers first when the top has drifted past the floor.
 */
export async function topPositions(listId: string, count: number, db: DbClient): Promise<number[]> {
  let min = await minPosition(db, listId, null);
  if (min !== null && min - count * POSITION_SPACING < REBALANCE_FLOOR) {
    await rebalanceList(listId, db);
    min = await minPosition(db, listId, null);
  }
  const base = min ?? (count + 1) * POSITION_SPACING;
  return Array.from({ length: count }, (_, i) => base - (count - i) * POSITION_SPACING);
}

/**
 * Give unplaced rows (NULL position, not a pending suggestion) positions at
 * the bottom of the list, newest first, as one block. Used when a list stops
 * having a source: its inbox joins the list below everything a person placed.
 */
export async function appendUnplaced(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH ceiling AS (
      SELECT COALESCE(MAX(position), 0) AS m
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND position IS NOT NULL
    ),
    pending AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ${sql.raw(RECENCY)}) AS rn
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND position IS NULL
        AND suggestion_state IS NULL
    )
    UPDATE items
    SET position = (ceiling.m + pending.rn * ${POSITION_SPACING})::int
    FROM pending, ceiling
    WHERE items.id = pending.id
  `);
}

/**
 * Give every unplaced row on a list without a source a position above the
 * current top, in the order they read (newest first). A no-op once the list
 * has none. Pending suggestions are left alone: they live in their own
 * section until accepted.
 */
async function materializePositions(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH floor AS (
      SELECT COALESCE(MIN(position), ${POSITION_SPACING}) AS m
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND position IS NOT NULL
    ),
    pending AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY ${sql.raw(RECENCY)}) AS rn,
             COUNT(*) OVER () AS n
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND position IS NULL
        AND suggestion_state IS NULL
    )
    UPDATE items
    SET position = (floor.m - (pending.n - pending.rn + 1) * ${POSITION_SPACING})::int
    FROM pending, floor
    WHERE items.id = pending.id
  `);
}

/** Re-space every placed row on the list to n*1024 in its current order. */
async function rebalanceList(listId: string, db: DbClient): Promise<void> {
  await db.execute(sql`
    WITH renumbered AS (
      SELECT id,
             (ROW_NUMBER() OVER (ORDER BY ${LIST_ORDER_SQL}) * ${POSITION_SPACING})::int AS p
      FROM items
      WHERE list_id = ${listId} AND archived_at IS NULL AND position IS NOT NULL
    )
    UPDATE items
    SET position = renumbered.p
    FROM renumbered
    WHERE items.id = renumbered.id
  `);
}

async function lookupPosition(db: DbClient, listId: string, id: string): Promise<number | null> {
  const [row] = await db
    .select({ position: items.position })
    .from(items)
    .where(and(eq(items.id, id), eq(items.listId, listId), isNull(items.archivedAt)))
    .limit(1);
  return row?.position ?? null;
}

async function minPosition(
  db: DbClient,
  listId: string,
  excludeId: string | null,
): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<number | null>`MIN(position)::int` })
    .from(items)
    .where(
      and(
        eq(items.listId, listId),
        isNull(items.archivedAt),
        sql`position IS NOT NULL`,
        excludeId ? sql`id <> ${excludeId}` : sql`TRUE`,
      ),
    );
  const min = row?.min;
  return min === null || min === undefined ? null : Number(min);
}

/**
 * The nearest placed position on the list next to `anchor`: "below" in the
 * displayed list is the next larger position, "above" the next smaller one.
 */
async function neighbourPosition(
  db: DbClient,
  listId: string,
  excludeId: string,
  direction: "above" | "below",
  anchor: number,
): Promise<number | null> {
  const cmp = direction === "below" ? sql`position > ${anchor}` : sql`position < ${anchor}`;
  const order = direction === "below" ? sql`position ASC` : sql`position DESC`;
  const rows = await db
    .select({ position: items.position })
    .from(items)
    .where(
      and(
        eq(items.listId, listId),
        isNull(items.archivedAt),
        sql`position IS NOT NULL`,
        sql`id <> ${excludeId}`,
        cmp,
      ),
    )
    .orderBy(order)
    .limit(1);
  return rows[0]?.position ?? null;
}
