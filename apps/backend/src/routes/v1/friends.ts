// Friends surface (spec §3.4, G2a) — share-link invites + the symmetric
// friend graph. Friendship is binary: no roles, no capability matrix.
// Others' game scores are gated solely by `friendsOf(viewer)` (see
// `routes/v1/games.ts`).

import type {
  AcceptFriendRequestResponse,
  FriendInviteResponse,
  FriendRequestPreview,
  FriendRequestStatus,
  FriendsResponse,
} from "@workshop/shared/friends";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import { friendRequests, friendships, users } from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { toIsoString } from "../../lib/dates.js";
import { addFriendship, canonicalPair, removeFriendship } from "../../lib/friends.js";
import { err, ok } from "../../lib/response.js";
import { generateShareSlug, isValidShareSlug } from "../../lib/shareSlug.js";
import { requireAuth } from "../../middleware/auth.js";
import { type RateLimitKeyFn, rateLimit } from "../../middleware/rate-limit.js";

const ipKey: RateLimitKeyFn = (c) => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeStatus(value: string): FriendRequestStatus {
  return value === "accepted" || value === "declined" ? value : "pending";
}

/**
 * Where the invite link lands. G2b owns the client accept route; the web
 * origin mirrors the CORS allowlist in `app.ts` (prod Pages domain).
 */
function friendInviteUrl(token: string): string {
  const base = getConfig().isLocal ? "http://localhost:8081" : "https://workshop-a2v.pages.dev";
  return `${base}/friends/accept/${token}`;
}

export const friendRoutes = new Hono();

// Same flag gate as the games surface (spec §3: 404 — not 403 — so the
// surface is indistinguishable from absent when off).
friendRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  await next();
});

// --- GET /v1/friends — my friends, newest edge first ---

friendRoutes.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const edges = await db
    .select({
      userLow: friendships.userLow,
      userHigh: friendships.userHigh,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));

  const byFriendId = new Map(
    edges.map((e) => [e.userLow === userId ? e.userHigh : e.userLow, e.createdAt]),
  );
  const friendIds = [...byFriendId.keys()];
  const userRows =
    friendIds.length === 0
      ? []
      : await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, friendIds));

  const friends = userRows
    .map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      friendsSince: toIsoString(byFriendId.get(u.id) ?? new Date(0)),
    }))
    .sort((a, b) => b.friendsSince.localeCompare(a.friendsSince));

  const response: FriendsResponse = { friends };
  return ok(c, response);
});

// --- POST /v1/friends/invite — get my personal share-link invite ---
// The link is **reusable** (anyone who opens it can add me — see the accept
// handler), so a user has exactly one stable personal link: reuse the
// existing row if present, mint one on first request. Re-opening Friends or
// re-sharing therefore returns the same URL instead of accumulating dead rows.

friendRoutes.post(
  "/invite",
  requireAuth,
  rateLimit({
    family: "v1.friends.invite",
    limit: 30,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const db = getDb();

    // Stable link: reuse the oldest existing one for this inviter.
    const [existing] = await db
      .select({ token: friendRequests.token })
      .from(friendRequests)
      .where(eq(friendRequests.inviterId, userId))
      .orderBy(asc(friendRequests.createdAt))
      .limit(1);
    if (existing) {
      const response: FriendInviteResponse = {
        token: existing.token,
        url: friendInviteUrl(existing.token),
      };
      return ok(c, response, 201);
    }

    // First link for this user — mint one. Slug collisions are rare but
    // real at scale, so retry a few times.
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = generateShareSlug();
      const [inserted] = await db
        .insert(friendRequests)
        .values({ inviterId: userId, token })
        .onConflictDoNothing({ target: friendRequests.token })
        .returning({ token: friendRequests.token });
      if (inserted) {
        const response: FriendInviteResponse = {
          token: inserted.token,
          url: friendInviteUrl(inserted.token),
        };
        return ok(c, response, 201);
      }
    }
    return err(c, "INTERNAL", "could not allocate an invite token");
  },
);

// --- GET /v1/friends/requests/:token — public inviter preview ---
// No auth: the recipient sees who's inviting them before signing in (same
// shape as the public list-share preview). Unauthenticated DB endpoint, so
// the opening query wraps in withDbRetry (Neon cold-start; backend CLAUDE.md).

friendRoutes.get(
  "/requests/:token",
  rateLimit({ family: "v1.friends.preview", limit: 60, windowSec: 60, key: ipKey }),
  async (c) => {
    const token = c.req.param("token");
    if (!isValidShareSlug(token)) return err(c, "NOT_FOUND", "invite not found");

    const db = getDb();
    const [row] = await withDbRetry(() =>
      db
        .select({
          status: friendRequests.status,
          inviterId: users.id,
          inviterName: users.displayName,
        })
        .from(friendRequests)
        .innerJoin(users, eq(users.id, friendRequests.inviterId))
        .where(eq(friendRequests.token, token))
        .limit(1),
    );
    if (!row) return err(c, "NOT_FOUND", "invite not found");

    const response: FriendRequestPreview = {
      inviter: { userId: row.inviterId, displayName: row.inviterName },
      status: normalizeStatus(row.status),
    };
    return ok(c, response);
  },
);

// --- POST /v1/friends/requests/:token/accept ---

friendRoutes.post(
  "/requests/:token/accept",
  requireAuth,
  rateLimit({
    family: "v1.friends.accept",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const token = c.req.param("token");
    if (!isValidShareSlug(token)) return err(c, "NOT_FOUND", "invite not found");

    const db = getDb();
    const [request] = await db
      .select({ inviterId: friendRequests.inviterId })
      .from(friendRequests)
      .where(eq(friendRequests.token, token))
      .limit(1);
    if (!request) return err(c, "NOT_FOUND", "invite not found");
    if (request.inviterId === userId) {
      return err(c, "VALIDATION", "you can't accept your own invite");
    }

    // Reusable link: anyone who opens it can add the inviter, any number of
    // times. The `friendships` edge is the source of truth and the insert is
    // idempotent, so re-accepting (or a second person accepting) is a no-op
    // beyond ensuring the edge exists. The legacy `status` / `invitee_id` /
    // `responded_at` columns are left untouched (see schema comment).
    await addFriendship(request.inviterId, userId);

    const pair = canonicalPair(request.inviterId, userId);
    const [edge] = await db
      .select({ createdAt: friendships.createdAt })
      .from(friendships)
      .where(and(eq(friendships.userLow, pair.userLow), eq(friendships.userHigh, pair.userHigh)))
      .limit(1);
    const [inviter] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, request.inviterId))
      .limit(1);
    if (!edge || !inviter) return err(c, "INTERNAL", "inviter lookup failed");

    const response: AcceptFriendRequestResponse = {
      friend: {
        userId: inviter.id,
        displayName: inviter.displayName,
        friendsSince: toIsoString(edge.createdAt),
      },
    };
    return ok(c, response);
  },
);

// --- DELETE /v1/friends/:userId — unfriend (scores stay, visibility stops) ---

friendRoutes.delete("/:userId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const target = c.req.param("userId");
  if (!UUID_RE.test(target)) return err(c, "NOT_FOUND", "friend not found");
  if (target === userId) return err(c, "VALIDATION", "you can't unfriend yourself");

  await removeFriendship(userId, target);
  return ok(c, { ok: true });
});
