// Server side of the list-kind registry (`@workshop/shared/listKinds`).
//
// Two invariants every list write keeps, in the transaction that writes:
//   1. `sources` is on exactly when the list has at least one `list_sources`
//      row. It is never a toggle; a client sending it is ignored.
//   2. `letterboxd` (the "Letterboxd match" toggle, movie lists only) is on
//      exactly when the list has a `letterboxd_match` source: turning the
//      toggle on attaches one, turning it off removes it, and removing that
//      source turns the toggle off.
//
// Toggles a kind does not offer are rejected with 400 `feature_not_offered`
// when a request turns them on; see `resolveListModules` for the tolerance
// rules that keep old clients working.

import {
  isSyncSourceOffered,
  LETTERBOXD_MATCH_SOURCE_KIND,
  resolveListModules,
  type ToggleFeature,
} from "@workshop/shared/listKinds";
import type { ModuleName } from "@workshop/shared/modules";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { listSources, lists } from "../db/schema.js";
import { recordEvent } from "./events.js";
import { err } from "./response.js";
import type { DbClient } from "./sql.js";

export const LETTERBOXD_MATCH_SOURCE = LETTERBOXD_MATCH_SOURCE_KIND;

/** A list with a `leaderboard` module is the retired games shape; leave it as it is. */
export function isLegacyLeaderboardList(modules: readonly string[] | null | undefined): boolean {
  return (modules ?? []).includes("leaderboard");
}

/**
 * Whether a source kind may be attached to a list of this kind: a sync source
 * the registry lists for it, or the Letterboxd-match source on a movie list.
 */
export function isSourceOfferedForKind(itemKind: string | null, sourceKind: string): boolean {
  if (sourceKind === LETTERBOXD_MATCH_SOURCE) return itemKind === "movie";
  return isSyncSourceOffered(itemKind, sourceKind);
}

export function featureNotOfferedResponse(
  c: Context,
  itemKind: string | null,
  features: readonly ToggleFeature[],
) {
  return err(c, "VALIDATION", "That feature isn't available on this kind of list.", {
    code: "feature_not_offered",
    features,
    itemKind,
  });
}

export function sourceNotOfferedResponse(c: Context, itemKind: string | null, kind: string) {
  return err(c, "VALIDATION", "This kind of list can't sync from that.", {
    code: "source_not_offered",
    kind,
    itemKind,
  });
}

export async function countSources(
  db: DbClient,
  listId: string,
): Promise<{ sync: number; match: number }> {
  const rows = await db
    .select({
      sync: sql<number>`COUNT(*) FILTER (WHERE ${listSources.kind} <> ${LETTERBOXD_MATCH_SOURCE})::int`,
      match: sql<number>`COUNT(*) FILTER (WHERE ${listSources.kind} = ${LETTERBOXD_MATCH_SOURCE})::int`,
    })
    .from(listSources)
    .where(eq(listSources.listId, listId));
  return { sync: Number(rows[0]?.sync ?? 0), match: Number(rows[0]?.match ?? 0) };
}

/**
 * Attach or remove the Letterboxd-match source so it follows the `letterboxd`
 * toggle. Attaching does not sync: the list's "Check for matches" does, and a
 * scrape inside a settings toggle would hold the switch for seconds.
 */
export async function syncLetterboxdMatchSource(args: {
  db: DbClient;
  listId: string;
  userId: string;
  on: boolean;
}): Promise<void> {
  const { db, listId, userId, on } = args;
  const existing = await db
    .select({ id: listSources.id })
    .from(listSources)
    .where(and(eq(listSources.listId, listId), eq(listSources.kind, LETTERBOXD_MATCH_SOURCE)));
  if (on && existing.length === 0) {
    await db.insert(listSources).values({ listId, kind: LETTERBOXD_MATCH_SOURCE, config: {} });
    await recordEvent({
      db,
      listId,
      actorId: userId,
      type: "source_added",
      payload: { kind: LETTERBOXD_MATCH_SOURCE, config: {} },
    });
  } else if (!on && existing.length > 0) {
    await db
      .delete(listSources)
      .where(and(eq(listSources.listId, listId), eq(listSources.kind, LETTERBOXD_MATCH_SOURCE)));
    await recordEvent({
      db,
      listId,
      actorId: userId,
      type: "source_removed",
      payload: { kind: LETTERBOXD_MATCH_SOURCE },
    });
  }
}

/**
 * Re-derive a list's modules from its sources after one was attached or
 * removed, and write them if they changed. Returns the stored modules.
 */
export async function reconcileListModules(args: {
  db: DbClient;
  listId: string;
}): Promise<ModuleName[] | null> {
  const { db, listId } = args;
  const [list] = await db
    .select({ itemKind: lists.itemKind, modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!list) return null;
  const current = list.modules ?? [];
  if (isLegacyLeaderboardList(current)) return current as ModuleName[];
  const counts = await countSources(db, listId);
  const requested = current.filter((m) => m !== "letterboxd");
  if (counts.match > 0) requested.push("letterboxd");
  const { modules } = resolveListModules({
    itemKind: list.itemKind,
    requested,
    current,
    syncSourceCount: counts.sync,
  });
  if (modules.join(",") !== current.join(",")) {
    await db.update(lists).set({ modules }).where(eq(lists.id, listId));
  }
  return modules;
}
