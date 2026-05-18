// Scheduled source sync (§3.7 of the redesign). Picks the next batch of
// pull-driven sources whose `sync_schedule` has elapsed since their last
// successful sync, runs each sync with the source's last actor, and updates
// `last_synced_at`. Designed to be called from a cron tick — the Lambda's
// EventBridge scheduled rule (when wired) invokes a handler that calls
// `runScheduledSyncTick`.
//
// Today no source row has `sync_schedule` set, so this is a no-op in prod.
// Scaffolding lands ahead of the cron rule so the first user-facing
// "schedule" toggle in settings can write a value and have it picked up.

import { isSourceKind, type SourceKind } from "@workshop/shared/sourceKinds";
import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { listSources } from "../../db/schema.js";
import { recordEvent } from "../events.js";
import { logger } from "../logger.js";
import type { DbClient } from "../sql.js";
import { dispatchFor } from "./registry.js";

/**
 * Cron interval expressed in seconds. Lists with a `sync_schedule` of e.g.
 * "hourly" are stored as seconds (3600) — the cron rule's job is to call
 * this tick periodically (say every 5 minutes), then we pick up whichever
 * sources have elapsed past their interval.
 */
function parseScheduleSeconds(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 60) return null;
  return Math.floor(n);
}

export interface TickResult {
  scanned: number;
  synced: number;
  skipped: number;
  errors: number;
}

export async function runScheduledSyncTick(args: { db?: DbClient } = {}): Promise<TickResult> {
  const db = args.db ?? getDb();

  // Select rows whose schedule has elapsed. `sync_schedule` is the interval
  // in seconds (text-encoded so we can grow to cron syntax later without a
  // migration). Pick rows where `last_synced_at IS NULL` or
  // `now() - last_synced_at >= sync_schedule::interval`.
  const rows = await db
    .select()
    .from(listSources)
    .where(
      and(
        isNotNull(listSources.syncSchedule),
        or(
          sql`${listSources.lastSyncedAt} IS NULL`,
          lte(
            listSources.lastSyncedAt,
            sql`now() - (${listSources.syncSchedule}::int * interval '1 second')`,
          ),
        ),
      ),
    )
    .limit(50);

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  for (const source of rows) {
    const intervalSec = parseScheduleSeconds(source.syncSchedule);
    if (intervalSec === null) {
      skipped += 1;
      continue;
    }
    if (!isSourceKind(source.kind)) {
      skipped += 1;
      continue;
    }
    const kind = source.kind as SourceKind;
    try {
      const dispatch = dispatchFor(kind);
      const result = await dispatch.sync({
        listId: source.listId,
        userId: source.lastSyncedBy ?? source.listId,
        config: (source.config ?? {}) as Record<string, unknown>,
        db,
      });
      await db
        .update(listSources)
        .set({ lastSyncedAt: result.refreshedAt })
        .where(eq(listSources.id, source.id));
      if (source.lastSyncedBy) {
        await recordEvent({
          listId: source.listId,
          actorId: source.lastSyncedBy,
          type: "source_synced",
          payload: { kind: source.kind, addedCount: result.addedCount, via: "schedule" },
        });
      }
      synced += 1;
    } catch (error) {
      logger.error("scheduled sync failed", { error, sourceId: source.id, kind: source.kind });
      errors += 1;
    }
  }

  return { scanned: rows.length, synced, skipped, errors };
}
