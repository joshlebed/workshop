// Integration tests for `DELETE /v1/users/me` — permanent account deletion.
//
// These run the real SQL against in-memory PGlite with the actual `drizzle/`
// migrations applied (same harness as friends.test.ts / games.test.ts),
// because the acceptance criteria *are* DB behaviors: every FK edge off
// `users.id` has to be cleared, other users' data has to survive, and the
// whole thing has to roll back as one unit. No production database is ever
// involved.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so `getDb` resolves to PGlite everywhere.
import { deleteUserAccount } from "../../lib/accountDeletion.js";
import { userRoutes } from "./users.js";

const doomed = "00000000-0000-4000-8000-0000000000d1";
const bystander = "00000000-0000-4000-8000-0000000000b1";
const admin = "00000000-0000-4000-8000-0000000000a1";
const gameId = "00000000-0000-4000-8000-0000000000f1";
const PERIOD = "2026-06-10";

function authHeaders(asUser: string, opts: { impersonatedBy?: string } = {}) {
  const token = opts.impersonatedBy
    ? signSession(asUser, { impersonatorUserId: opts.impersonatedBy })
    : signSession(asUser);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function count(table: string, where: string, params: unknown[] = []): Promise<number> {
  const [row] = await rows<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return Number(row?.n ?? "0");
}

/**
 * A lived-in fixture: the doomed user owns a shared list, has contributed an
 * item and an activity event to somebody else's list, has games/scores/
 * reactions/friendships/invites, an identity row, a device session, an admin
 * session impersonating them, and a rate-limit bucket. The bystander has the
 * mirror image of all of it.
 */
async function seed() {
  // Restrict FKs mean users can't be cleared first — drop the referencing
  // rows, then the lists (which cascade the rest), then the users themselves.
  await rows(`DELETE FROM activity_events`);
  await rows(`DELETE FROM list_invites`);
  await rows(`DELETE FROM items`);
  await rows(`DELETE FROM lists`);
  await rows(`DELETE FROM users`);
  await rows(`DELETE FROM games WHERE id = $1`, [gameId]);
  await rows(`DELETE FROM rate_limits`);

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'doomed@example.com', 'Doomed'),
       ($2, 'bystander@example.com', 'Bystander'),
       ($3, 'admin@example.com', 'Admin')`,
    [doomed, bystander, admin],
  );
  await rows(
    `INSERT INTO user_identities (provider, provider_sub, user_id, provider_client_id)
     VALUES ('apple', 'apple-doomed', $1, 'live.highscore.app'),
            ('google', 'google-doomed', $1, NULL),
            ('apple', 'apple-bystander', $2, NULL)`,
    [doomed, bystander],
  );
  await rows(
    `INSERT INTO auth_sessions (user_id, impersonated_user_id, idle_expires_at, absolute_expires_at)
     VALUES ($1, NULL, now() + interval '1 day', now() + interval '30 days'),
            ($3, $1,   now() + interval '1 day', now() + interval '30 days'),
            ($2, NULL, now() + interval '1 day', now() + interval '30 days')`,
    [doomed, bystander, admin],
  );

  // Two lists: one owned by the doomed user (shared with the bystander), one
  // owned by the bystander (which the doomed user contributed to).
  const doomedList = "00000000-0000-4000-8000-000000000001";
  const bystanderList = "00000000-0000-4000-8000-000000000002";
  await rows(
    `INSERT INTO lists (id, name, emoji, color, owner_id, share_slug) VALUES
       ($1, 'Doomed list', '🎯', '#fff', $3, 'slugdoom'),
       ($2, 'Bystander list', '📚', '#eee', $4, 'slugbyst')`,
    [doomedList, bystanderList, doomed, bystander],
  );

  await rows(
    `INSERT INTO list_members (list_id, user_id, role) VALUES
       ($1, $3, 'owner'), ($1, $4, 'member'), ($2, $4, 'owner')`,
    [doomedList, bystanderList, doomed, bystander],
  );
  await rows(
    `INSERT INTO list_invites (list_id, token, invited_by) VALUES
       ($1, 'invite-doomed', $3), ($2, 'invite-bystander', $4)`,
    [doomedList, bystanderList, doomed, bystander],
  );
  await rows(
    `INSERT INTO items (id, list_id, title, added_by) VALUES
       ('00000000-0000-4000-8000-000000000011'::uuid, $1, 'In own list', $3),
       ('00000000-0000-4000-8000-000000000012'::uuid, $2, 'In their list', $3),
       ('00000000-0000-4000-8000-000000000013'::uuid, $2, 'Their own item', $4)`,
    [doomedList, bystanderList, doomed, bystander],
  );
  await rows(
    `INSERT INTO activity_events (list_id, actor_id, event_type) VALUES
       ($1, $3, 'item_added'), ($2, $3, 'item_added'), ($2, $4, 'item_added')`,
    [doomedList, bystanderList, doomed, bystander],
  );
  await rows(`INSERT INTO user_activity_reads (user_id, list_id) VALUES ($1, $2)`, [
    doomed,
    doomedList,
  ]);
  await rows(
    `INSERT INTO list_saved_views (list_id, name, config, created_by, position)
     VALUES ($1, 'Mine', '{}'::jsonb, $2, 0)`,
    [bystanderList, doomed],
  );

  // Games surface.
  await rows(
    `INSERT INTO games (id, title, url, normalized_url) VALUES ($1, 'Wordle', 'https://w', 'w')`,
    [gameId],
  );
  await rows(
    `INSERT INTO user_games (user_id, game_id, position) VALUES ($1, $3, 0), ($2, $3, 0)`,
    [doomed, bystander, gameId],
  );
  await rows(
    `INSERT INTO game_scores (game_id, user_id, period_key, score_raw) VALUES
       ($1, $2, $4, '3/6'), ($1, $3, $4, '4/6')`,
    [gameId, doomed, bystander, PERIOD],
  );
  // The doomed user reacted to the bystander's score, and vice versa.
  await rows(
    `INSERT INTO game_score_reactions (game_id, period_key, score_user_id, reactor_user_id, emoji)
     VALUES ($1, $4, $3, $2, '🔥'), ($1, $4, $2, $3, '👏')`,
    [gameId, doomed, bystander, PERIOD],
  );
  await rows(
    `INSERT INTO game_share_links (user_id, date_key, token) VALUES ($1, $3, 'tok-doomed'), ($2, $3, 'tok-byst')`,
    [doomed, bystander, PERIOD],
  );
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [
    doomed < bystander ? doomed : bystander,
    doomed < bystander ? bystander : doomed,
  ]);
  await rows(
    `INSERT INTO friend_requests (inviter_id, invitee_id, token) VALUES ($1, $2, NULL), ($2, NULL, 'link-byst')`,
    [doomed, bystander],
  );
  await rows(
    `INSERT INTO letterboxd_watchlist_films (user_id, film_slug, title) VALUES ($1, 'heat', 'Heat')`,
    [doomed],
  );
  await rows(
    `INSERT INTO rate_limits (bucket_key, window_start, count) VALUES
       ($1, now(), 1), ($2, now(), 1)`,
    [`v1.users.letterboxd-connect:${doomed}`, `v1.users.letterboxd-connect:${bystander}`],
  );

  return { doomedList, bystanderList };
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  await seed();
});

describe("DELETE /v1/users/me — authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await userRoutes.request("/me", { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await count("users", "id = $1", [doomed])).toBe(1);
  });

  it("deletes only the token's own user — there is no target parameter", async () => {
    // Even with another user's id in the body, the subject is the bearer token.
    const res = await userRoutes.request("/me", {
      method: "DELETE",
      headers: authHeaders(doomed),
      body: JSON.stringify({ userId: bystander }),
    });
    expect(res.status).toBe(200);
    expect(await count("users", "id = $1", [bystander])).toBe(1);
    expect(await count("users", "id = $1", [doomed])).toBe(0);
  });

  it("refuses while an admin is impersonating the account", async () => {
    const res = await userRoutes.request("/me", {
      method: "DELETE",
      headers: authHeaders(doomed, { impersonatedBy: admin }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "FORBIDDEN",
      details: { code: "IMPERSONATION_ACTIVE" },
    });
    expect(await count("users", "id = $1", [doomed])).toBe(1);
  });

  it("404s a repeat delete once the account is gone", async () => {
    // In production the auth middleware rejects first (a missing user reads as
    // a revoked session → 401); the global test-setup mock stubs that out, so
    // this asserts the handler's own second-call behavior. Either way the
    // repeat is a safe no-op, never a 500.
    expect(
      (await userRoutes.request("/me", { method: "DELETE", headers: authHeaders(doomed) })).status,
    ).toBe(200);
    const again = await userRoutes.request("/me", {
      method: "DELETE",
      headers: authHeaders(doomed),
    });
    expect(again.status).toBe(404);
  });
});

describe("DELETE /v1/users/me — cascade", () => {
  it("removes the account and every row that belongs to it", async () => {
    const res = await userRoutes.request("/me", {
      method: "DELETE",
      headers: authHeaders(doomed),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deletedUserId: doomed });

    expect(await count("users", "id = $1", [doomed])).toBe(0);
    expect(await count("user_identities", "user_id = $1", [doomed])).toBe(0);
    expect(await count("auth_sessions", "user_id = $1", [doomed])).toBe(0);
    // The admin's device session was pointed at this user — revoked outright,
    // not silently reset to the admin's own account by the `set null` FK.
    expect(await count("auth_sessions", "user_id = $1", [admin])).toBe(0);
    expect(await count("lists", "owner_id = $1", [doomed])).toBe(0);
    expect(await count("items", "added_by = $1", [doomed])).toBe(0);
    expect(await count("list_invites", "invited_by = $1", [doomed])).toBe(0);
    expect(await count("activity_events", "actor_id = $1", [doomed])).toBe(0);
    expect(await count("list_members", "user_id = $1", [doomed])).toBe(0);
    expect(await count("user_activity_reads", "user_id = $1", [doomed])).toBe(0);
    expect(await count("user_games", "user_id = $1", [doomed])).toBe(0);
    expect(await count("game_scores", "user_id = $1", [doomed])).toBe(0);
    expect(await count("game_score_reactions", "reactor_user_id = $1", [doomed])).toBe(0);
    // …and reactions other people left ON the deleted user's score.
    expect(await count("game_score_reactions", "score_user_id = $1", [doomed])).toBe(0);
    expect(await count("game_share_links", "user_id = $1", [doomed])).toBe(0);
    expect(await count("friendships", "user_low = $1 OR user_high = $1", [doomed])).toBe(0);
    expect(await count("friend_requests", "inviter_id = $1 OR invitee_id = $1", [doomed])).toBe(0);
    expect(await count("letterboxd_watchlist_films", "user_id = $1", [doomed])).toBe(0);
    expect(await count("rate_limits", "bucket_key LIKE $1", [`%:${doomed}`])).toBe(0);
  });

  it("takes the members and contents of lists it owned with it", async () => {
    const { doomedList } = await seed();
    await userRoutes.request("/me", { method: "DELETE", headers: authHeaders(doomed) });
    expect(await count("lists", "id = $1", [doomedList])).toBe(0);
    expect(await count("list_members", "list_id = $1", [doomedList])).toBe(0);
    expect(await count("items", "list_id = $1", [doomedList])).toBe(0);
    expect(await count("activity_events", "list_id = $1", [doomedList])).toBe(0);
  });
});

describe("DELETE /v1/users/me — preservation", () => {
  it("leaves every other user's own data intact", async () => {
    const { bystanderList } = await seed();
    await userRoutes.request("/me", { method: "DELETE", headers: authHeaders(doomed) });

    expect(await count("users", "id = $1", [bystander])).toBe(1);
    expect(await count("users", "id = $1", [admin])).toBe(1);
    expect(await count("user_identities", "user_id = $1", [bystander])).toBe(1);
    expect(await count("lists", "id = $1", [bystanderList])).toBe(1);
    expect(await count("items", "added_by = $1", [bystander])).toBe(1);
    expect(await count("activity_events", "actor_id = $1", [bystander])).toBe(1);
    expect(await count("list_invites", "invited_by = $1", [bystander])).toBe(1);
    expect(await count("user_games", "user_id = $1", [bystander])).toBe(1);
    expect(await count("game_scores", "user_id = $1", [bystander])).toBe(1);
    expect(await count("game_share_links", "user_id = $1", [bystander])).toBe(1);
    expect(await count("friend_requests", "inviter_id = $1", [bystander])).toBe(1);
    expect(await count("rate_limits", "bucket_key LIKE $1", [`%:${bystander}`])).toBe(1);
  });

  it("keeps shared reference data, nulling the deleted user's attribution", async () => {
    const { bystanderList } = await seed();
    await userRoutes.request("/me", { method: "DELETE", headers: authHeaders(doomed) });

    // The global games catalog is not personal data.
    expect(await count("games", "id = $1", [gameId])).toBe(1);
    // A saved view the deleted user created on someone else's list survives
    // with a null author (`created_by` is ON DELETE SET NULL by design).
    expect(await count("list_saved_views", "list_id = $1", [bystanderList])).toBe(1);
    expect(await count("list_saved_views", "created_by IS NULL", [])).toBe(1);
  });
});

describe("deleteUserAccount", () => {
  it("is a no-op that reports zero when the account is already gone", async () => {
    await deleteUserAccount(doomed);
    const counts = await deleteUserAccount(doomed);
    expect(counts.users).toBe(0);
  });

  it("rolls the whole thing back when any statement fails", async () => {
    const { doomedList } = await seed();
    // Stand in for a future `ON DELETE restrict` FK that this module doesn't
    // know about: the final `DELETE FROM users` must raise and undo everything
    // already deleted in the transaction, rather than leave a half-account.
    await rows(
      `CREATE TABLE deletion_blocker (user_id uuid REFERENCES users(id) ON DELETE RESTRICT)`,
    );
    await rows(`INSERT INTO deletion_blocker (user_id) VALUES ($1)`, [doomed]);

    await expect(deleteUserAccount(doomed)).rejects.toThrow();

    expect(await count("users", "id = $1", [doomed])).toBe(1);
    expect(await count("lists", "id = $1", [doomedList])).toBe(1);
    expect(await count("items", "added_by = $1", [doomed])).toBe(2);
    expect(await count("activity_events", "actor_id = $1", [doomed])).toBe(2);
    expect(await count("auth_sessions", "user_id = $1", [admin])).toBe(1);

    await rows(`DROP TABLE deletion_blocker`);
  });
});
