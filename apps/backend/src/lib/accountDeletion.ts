// Permanent account deletion — the data half of `DELETE /v1/users/me`.
//
// One backend, two apps. Workshop.dev and HighScore share the same `users` /
// `user_identities` rows (signing into HighScore with the Apple ID you use on
// Workshop resolves to one account — see routes/v1/auth.ts `upsertIdentity`),
// so deleting from HighScore necessarily deletes the Workshop side too. That's
// stated plainly in the client's confirmation copy rather than hidden.
//
// ## What gets deleted
//
// Most user-owned tables already cascade from `users.id`; this module exists
// for the four `ON DELETE restrict` edges that would otherwise block the row,
// plus a couple of rows that reference the user indirectly:
//
//   restrict → `lists.owner_id`, `items.added_by`, `list_invites.invited_by`,
//              `activity_events.actor_id`
//   indirect → `auth_sessions.impersonated_user_id` (an admin session pointed
//              at this user would otherwise be silently reset to the admin's
//              own account by the `set null` FK), and the user's `rate_limits`
//              buckets.
//
// Owned lists are deleted outright, which takes their items, members, invites,
// saved views, activity and sources with them by cascade — including rows other
// members contributed *to that list*. Every other user's own lists survive; the
// deleted user's contributions inside them (their items, their activity, their
// invites) go, since that's their user-generated content.
//
// Deliberately preserved: the global `games` catalog and `game_spec_revisions`
// (shared reference data — `taught_by` is `set null`), `metadata_cache` (not
// personal), and `items.completed_by` / `list_saved_views.created_by` /
// `list_sources.last_synced_by` on *other people's* lists, which the schema
// already nulls out.
//
// Everything runs in one transaction: either the account is gone or nothing
// changed. If some future `restrict` FK is added and not handled here, the
// final `DELETE FROM users` raises and the whole thing rolls back — a loud 500
// rather than a half-deleted account.

import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { executeRows } from "./sql.js";

/** Per-table row counts, in deletion order. Surfaced in logs and tests. */
interface AccountDeletionCounts {
  impersonatingSessions: number;
  activityEvents: number;
  listInvites: number;
  items: number;
  lists: number;
  rateLimits: number;
  users: number;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function deleteCount(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await executeRows(tx, query);
  return rows.length;
}

/**
 * Delete `userId` and every row that belongs to them, transactionally.
 * Returns the per-table counts. `users` is 0 when the account was already
 * gone, which makes a repeat call a no-op instead of an error.
 */
export async function deleteUserAccount(userId: string): Promise<AccountDeletionCounts> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Admin device sessions currently impersonating this user. The FK is
    // `set null`, which would quietly hand the admin back their own account
    // under a session they think is someone else's — revoke instead.
    const impersonatingSessions = await deleteCount(
      tx,
      sql`DELETE FROM auth_sessions WHERE impersonated_user_id = ${userId}::uuid RETURNING 1`,
    );
    const activityEvents = await deleteCount(
      tx,
      sql`DELETE FROM activity_events WHERE actor_id = ${userId}::uuid RETURNING 1`,
    );
    const listInvites = await deleteCount(
      tx,
      sql`DELETE FROM list_invites WHERE invited_by = ${userId}::uuid RETURNING 1`,
    );
    // Items this user added to lists they don't own. Items in their own lists
    // are swept by the list delete below; this DELETE catches both, harmlessly.
    const items = await deleteCount(
      tx,
      sql`DELETE FROM items WHERE added_by = ${userId}::uuid RETURNING 1`,
    );
    const lists = await deleteCount(
      tx,
      sql`DELETE FROM lists WHERE owner_id = ${userId}::uuid RETURNING 1`,
    );
    // Rate-limit buckets are keyed `<family>:<userId>` (middleware/rate-limit.ts).
    const rateLimits = await deleteCount(
      tx,
      sql`DELETE FROM rate_limits WHERE bucket_key LIKE ${`%:${userId}`} RETURNING 1`,
    );
    // Cascades: user_identities, auth_sessions, list_members, user_activity_reads,
    // user_games, letterboxd_watchlist_films, item_acceptances, game_scores,
    // game_score_reactions, game_share_links, friendships, friend_requests.
    const users = await deleteCount(
      tx,
      sql`DELETE FROM users WHERE id = ${userId}::uuid RETURNING 1`,
    );
    return {
      impersonatingSessions,
      activityEvents,
      listInvites,
      items,
      lists,
      rateLimits,
      users,
    };
  });
}
