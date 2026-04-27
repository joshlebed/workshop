import type { ActivityEventType } from "@workshop/shared";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { activityEvents } from "../db/schema.js";

/**
 * Synchronous insert into `activity_events`. Mutating handlers call this
 * inline (no queue) per spec §4.7 — v1 traffic doesn't justify SQS
 * complexity and the fingerprinted lambda env stays simpler. If event
 * recording becomes a dominant latency contributor it's a single-file swap
 * to a queue producer.
 *
 * `db` is optional so callers inside a `db.transaction(async (tx) => ...)`
 * block can pass `tx` and the event row joins the same transaction (or
 * gets rolled back together on failure). Standalone calls use the cached
 * Drizzle client. Mirrors the `metadata-cache.ts` pattern.
 */

interface DbLike {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}

interface RecordEventParams {
  listId: string;
  actorId: string;
  type: ActivityEventType;
  /** Set on item-scoped events; nullable on list/member/invite events. */
  itemId?: string | null;
  /** Event-specific payload; defaults to `{}`. */
  payload?: Record<string, unknown>;
  /** Defaults to the cached client; pass `tx` to enlist in an open transaction. */
  db?: DbLike;
}

export async function recordEvent(params: RecordEventParams): Promise<void> {
  const { listId, actorId, type, itemId = null, payload = {}, db = getDb() } = params;
  await db.execute(sql`
    INSERT INTO ${activityEvents} (list_id, actor_id, event_type, item_id, payload)
    VALUES (${listId}, ${actorId}, ${type}, ${itemId}, ${JSON.stringify(payload)}::jsonb)
  `);
}
