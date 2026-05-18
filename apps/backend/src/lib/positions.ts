// Sparse-integer position allocator for `items.position` (§3.4 of the
// redesign). Spacing of 1024 between siblings gives ~10⁹ headroom before any
// rebalance is needed; collisions trigger an eager rebalance of the list's
// ordered section in a single SQL statement.

import { and, eq, isNull, sql } from "drizzle-orm";
import { items } from "../db/schema.js";
import type { DbClient } from "./sql.js";

const POSITION_SPACING = 1024;

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
 * - both null            → demote (position = NULL)
 * - only beforeItemId    → place just after `before`
 * - only afterItemId     → place just before `after`
 * - both                 → place between them, rebalancing on collision
 */
export async function moveItemPosition(args: MoveArgs): Promise<MoveResult> {
  const { listId, itemId, beforeItemId, afterItemId, db } = args;

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
