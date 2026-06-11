// Friends surface (spec §3.4, G2a) — share-link invites + the symmetric
// friend graph. Friendship is binary: no roles, no capability matrix.
// Others' game scores are gated solely by `friendsOf(viewer)` (see
// `routes/v1/games.ts`).

import type {
  AcceptFriendRequestResponse,
  FriendInviteResponse,
  FriendProfileGame,
  FriendProfileResponse,
  FriendRequestPreview,
  FriendRequestStatus,
  FriendRequestSummary,
  FriendRequestsResponse,
  FriendSummary,
  FriendshipState,
  FriendsResponse,
  FriendUser,
  MutualSummary,
  MutualsResponse,
  SendFriendRequestResponse,
} from "@workshop/shared/friends";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import {
  friendRequests,
  friendships,
  gameScores,
  games,
  userGames,
  users,
} from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { toIsoString } from "../../lib/dates.js";
import { addFriendship, canonicalPair, friendsOf, removeFriendship } from "../../lib/friends.js";
import { todayPeriodKey, toGameShape } from "../../lib/gameShapes.js";
import { isUniqueViolation } from "../../lib/pgErrors.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { periodKeySchema } from "../../lib/scoreSchemas.js";
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

const sendRequestSchema = z.object({ userId: z.string().uuid() });

/**
 * Drop every pending directed request between two users (both directions).
 * Used by accept (the request is consumed), deny/cancel (silent delete —
 * re-requesting is allowed), and the cross-request auto-accept.
 */
async function deleteDirectedPending(a: string, b: string): Promise<void> {
  await getDb()
    .delete(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "pending"),
        or(
          and(eq(friendRequests.inviterId, a), eq(friendRequests.inviteeId, b)),
          and(eq(friendRequests.inviterId, b), eq(friendRequests.inviteeId, a)),
        ),
      ),
    );
}

/** The `friendships` edge between two users, or undefined. */
async function friendshipEdge(a: string, b: string): Promise<{ createdAt: Date } | undefined> {
  const pair = canonicalPair(a, b);
  const [edge] = await getDb()
    .select({ createdAt: friendships.createdAt })
    .from(friendships)
    .where(and(eq(friendships.userLow, pair.userLow), eq(friendships.userHigh, pair.userHigh)))
    .limit(1);
  return edge;
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

    // Stable link: reuse the oldest existing one for this inviter. Directed
    // requests share this table (`invitee_id` set, no token) — skip them.
    const [existing] = await db
      .select({ token: friendRequests.token })
      .from(friendRequests)
      .where(and(eq(friendRequests.inviterId, userId), isNull(friendRequests.inviteeId)))
      .orderBy(asc(friendRequests.createdAt))
      .limit(1);
    if (existing?.token) {
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
      if (inserted?.token) {
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

// --- POST /v1/friends/invite/reset — rotate my personal invite link ---
// Mints a fresh slug on my one stable invite row, invalidating the old link:
// anyone holding the previous URL now 404s on preview + accept. Same reusable-
// link model as /invite (one row per inviter) — this just rotates the slug, the
// way `POST /v1/lists/:id/share/reset` rotates a list's share slug. If I've
// never generated a link, this mints my first one, so reset doubles as a safe
// first-time create. Retries on the rare slug collision.

friendRoutes.post(
  "/invite/reset",
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

    // Rotate the canonical (oldest) LINK row only — legacy single-use data
    // could leave a user with several rows, and updating them all to one slug
    // would self-collide. The oldest `invitee_id IS NULL` row is the one
    // `/invite` hands out; directed-request rows (invitee set, token NULL)
    // must never receive a token or they'd become accept-able share links.
    const [existing] = await db
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(and(eq(friendRequests.inviterId, userId), isNull(friendRequests.inviteeId)))
      .orderBy(asc(friendRequests.createdAt))
      .limit(1);

    for (let attempt = 0; attempt < 5; attempt++) {
      const token = generateShareSlug();
      try {
        if (existing) {
          const [updated] = await db
            .update(friendRequests)
            .set({ token })
            .where(eq(friendRequests.id, existing.id))
            .returning({ token: friendRequests.token });
          if (updated?.token) {
            const response: FriendInviteResponse = {
              token: updated.token,
              url: friendInviteUrl(updated.token),
            };
            return ok(c, response);
          }
        } else {
          const [inserted] = await db
            .insert(friendRequests)
            .values({ inviterId: userId, token })
            .onConflictDoNothing({ target: friendRequests.token })
            .returning({ token: friendRequests.token });
          if (inserted?.token) {
            const response: FriendInviteResponse = {
              token: inserted.token,
              url: friendInviteUrl(inserted.token),
            };
            return ok(c, response, 201);
          }
        }
      } catch (e) {
        if (isUniqueViolation(e, "friend_requests_token_unique")) continue;
        throw e;
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
        .where(and(eq(friendRequests.token, token), isNull(friendRequests.inviteeId)))
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
      .where(and(eq(friendRequests.token, token), isNull(friendRequests.inviteeId)))
      .limit(1);
    if (!request) return err(c, "NOT_FOUND", "invite not found");
    if (request.inviterId === userId) {
      return err(c, "VALIDATION", "you can't accept your own invite");
    }

    // Reusable link: anyone who opens it can add the inviter, any number of
    // times. The `friendships` edge is the source of truth and the insert is
    // idempotent, so re-accepting (or a second person accepting) is a no-op
    // beyond ensuring the edge exists. This row's legacy `status` /
    // `responded_at` columns are left untouched (see schema comment), but any
    // pending *directed* request between the pair is consumed — the link
    // accept satisfied it.
    await addFriendship(request.inviterId, userId);
    await deleteDirectedPending(request.inviterId, userId);

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

// --- GET /v1/friends/requests — my pending directed requests, both sides ---
// Directed requests (mutuals / profile flow) live in `friend_requests` rows
// with `invitee_id` set; rows exist only while pending. Inbound powers the
// Requests section + the profile-menu badge; outbound powers "Requested"
// states on mutual cards and the profile page.

friendRoutes.get("/requests", requireAuth, async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [inboundRows, outboundRows] = await Promise.all([
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        requestedAt: friendRequests.createdAt,
      })
      .from(friendRequests)
      .innerJoin(users, eq(users.id, friendRequests.inviterId))
      .where(and(eq(friendRequests.inviteeId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.createdAt)),
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        requestedAt: friendRequests.createdAt,
      })
      .from(friendRequests)
      .innerJoin(users, eq(users.id, friendRequests.inviteeId))
      .where(and(eq(friendRequests.inviterId, userId), eq(friendRequests.status, "pending")))
      .orderBy(desc(friendRequests.createdAt)),
  ]);

  const toSummary = (r: (typeof inboundRows)[number]): FriendRequestSummary => ({
    userId: r.userId,
    displayName: r.displayName,
    requestedAt: toIsoString(r.requestedAt),
  });
  const response: FriendRequestsResponse = {
    inbound: inboundRows.map(toSummary),
    outbound: outboundRows.map(toSummary),
  };
  return ok(c, response);
});

// --- POST /v1/friends/requests — send a directed friend request ---
// Idempotent and convergent: already-friends returns `accepted`; a pending
// inbound from the target auto-accepts (both wanted it); a duplicate send
// no-ops on the partial unique index and stays `pending`.

friendRoutes.post(
  "/requests",
  requireAuth,
  rateLimit({
    family: "v1.friends.request",
    limit: 60,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const parsed = await parseJsonBody(c, sendRequestSchema);
    if (!parsed.ok) return parsed.response;
    const targetId = parsed.data.userId;
    if (targetId === userId) return err(c, "VALIDATION", "you can't friend yourself");

    const db = getDb();
    const [target] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target) return err(c, "NOT_FOUND", "user not found");

    const friendShape = (edgeCreatedAt: Date): FriendSummary => ({
      userId: target.id,
      displayName: target.displayName,
      friendsSince: toIsoString(edgeCreatedAt),
    });

    const existingEdge = await friendshipEdge(userId, targetId);
    if (existingEdge) {
      const response: SendFriendRequestResponse = {
        status: "accepted",
        friend: friendShape(existingEdge.createdAt),
      };
      return ok(c, response);
    }

    const [inbound] = await db
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.inviterId, targetId),
          eq(friendRequests.inviteeId, userId),
          eq(friendRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (inbound) {
      await addFriendship(userId, targetId);
      await deleteDirectedPending(userId, targetId);
      const edge = await friendshipEdge(userId, targetId);
      if (!edge) return err(c, "INTERNAL", "friendship lookup failed");
      const response: SendFriendRequestResponse = {
        status: "accepted",
        friend: friendShape(edge.createdAt),
      };
      return ok(c, response, 201);
    }

    await db
      .insert(friendRequests)
      .values({ inviterId: userId, inviteeId: targetId })
      .onConflictDoNothing();
    const response: SendFriendRequestResponse = { status: "pending", friend: null };
    return ok(c, response, 201);
  },
);

// --- POST /v1/friends/requests/user/:userId/accept — accept an inbound request ---
// Addressed by the sender's user id (the UI always knows it), under the
// `/requests/user/` prefix so it can't collide with the share-link token
// accept route above.

friendRoutes.post(
  "/requests/user/:userId/accept",
  requireAuth,
  rateLimit({
    family: "v1.friends.requestAccept",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const senderId = c.req.param("userId");
    if (!UUID_RE.test(senderId)) return err(c, "NOT_FOUND", "request not found");

    const db = getDb();
    const [pending] = await db
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.inviterId, senderId),
          eq(friendRequests.inviteeId, userId),
          eq(friendRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (!pending) return err(c, "NOT_FOUND", "request not found");

    await addFriendship(senderId, userId);
    await deleteDirectedPending(userId, senderId);

    const [edge, [sender]] = await Promise.all([
      friendshipEdge(userId, senderId),
      db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, senderId))
        .limit(1),
    ]);
    if (!edge || !sender) return err(c, "INTERNAL", "sender lookup failed");

    const response: AcceptFriendRequestResponse = {
      friend: {
        userId: sender.id,
        displayName: sender.displayName,
        friendsSince: toIsoString(edge.createdAt),
      },
    };
    return ok(c, response);
  },
);

// --- DELETE /v1/friends/requests/user/:userId — cancel or deny, silently ---
// One verb for both sides: drops any pending directed request between me and
// `:userId` (at most one direction can be pending — cross-requests
// auto-accept). Deny is invisible to the sender and re-requesting is allowed.

friendRoutes.delete("/requests/user/:userId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const otherId = c.req.param("userId");
  if (!UUID_RE.test(otherId)) return err(c, "NOT_FOUND", "request not found");
  if (otherId === userId) return err(c, "VALIDATION", "you can't request yourself");

  await deleteDirectedPending(userId, otherId);
  return ok(c, { ok: true });
});

// --- GET /v1/friends/mutuals — friends of friends, most-connected first ---
// Two-hop walk over `friendships`: candidates are everyone adjacent to one
// of my friends who isn't me and isn't already my friend. Computed in app
// code (two indexed queries) — friend graphs here are small.

friendRoutes.get("/mutuals", requireAuth, async (c) => {
  const userId = c.get("userId");
  const myFriends = await friendsOf(userId);
  if (myFriends.length === 0) {
    const response: MutualsResponse = { mutuals: [] };
    return ok(c, response);
  }

  const friendSet = new Set(myFriends);
  const db = getDb();
  const edges = await db
    .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
    .from(friendships)
    .where(or(inArray(friendships.userLow, myFriends), inArray(friendships.userHigh, myFriends)));

  // candidate id → which of my friends connect to them.
  const connectorsByCandidate = new Map<string, Set<string>>();
  for (const e of edges) {
    for (const [mine, other] of [
      [e.userLow, e.userHigh],
      [e.userHigh, e.userLow],
    ] as const) {
      if (!friendSet.has(mine)) continue;
      if (other === userId || friendSet.has(other)) continue;
      const connectors = connectorsByCandidate.get(other) ?? new Set<string>();
      connectors.add(mine);
      connectorsByCandidate.set(other, connectors);
    }
  }
  if (connectorsByCandidate.size === 0) {
    const response: MutualsResponse = { mutuals: [] };
    return ok(c, response);
  }

  const nameIds = [
    ...new Set([
      ...connectorsByCandidate.keys(),
      ...[...connectorsByCandidate.values()].flatMap((s) => [...s]),
    ]),
  ];
  const nameRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, nameIds));
  const nameById = new Map(nameRows.map((u) => [u.id, u.displayName]));
  const byName = (a: FriendUser, b: FriendUser) =>
    (a.displayName ?? "").localeCompare(b.displayName ?? "");

  const mutuals: MutualSummary[] = [...connectorsByCandidate.entries()]
    .map(([candidateId, connectors]) => ({
      userId: candidateId,
      displayName: nameById.get(candidateId) ?? null,
      mutualCount: connectors.size,
      mutualFriends: [...connectors]
        .map((id) => ({ userId: id, displayName: nameById.get(id) ?? null }))
        .sort(byName),
    }))
    .sort((a, b) => b.mutualCount - a.mutualCount || byName(a, b));

  const response: MutualsResponse = { mutuals };
  return ok(c, response);
});

// --- GET /v1/friends/users/:userId — a user's profile, viewer-relative ---
// Games (with the subject's score for `?period=`, default today UTC) are
// attached only for friends/self; everyone else gets `games: null` ("add
// them to see what they play"). A viewer with no relationship AND no mutual
// friends gets 404 — indistinguishable from a missing user, so the endpoint
// can't be used to probe arbitrary ids.

friendRoutes.get("/users/:userId", requireAuth, async (c) => {
  const viewerId = c.get("userId");
  const targetId = c.req.param("userId");
  if (!UUID_RE.test(targetId)) return err(c, "NOT_FOUND", "user not found");

  const periodRaw = c.req.query("period");
  let periodKey = todayPeriodKey();
  if (periodRaw !== undefined) {
    const parsedPeriod = periodKeySchema.safeParse(periodRaw);
    if (!parsedPeriod.success) return err(c, "VALIDATION", "invalid period");
    periodKey = parsedPeriod.data;
  }

  const db = getDb();
  const [target] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  if (!target) return err(c, "NOT_FOUND", "user not found");

  let relationship: FriendshipState = "none";
  let friendsSince: string | null = null;
  if (targetId === viewerId) {
    relationship = "self";
  } else {
    const edge = await friendshipEdge(viewerId, targetId);
    if (edge) {
      relationship = "friends";
      friendsSince = toIsoString(edge.createdAt);
    } else {
      const pendings = await db
        .select({ inviterId: friendRequests.inviterId })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.status, "pending"),
            or(
              and(eq(friendRequests.inviterId, viewerId), eq(friendRequests.inviteeId, targetId)),
              and(eq(friendRequests.inviterId, targetId), eq(friendRequests.inviteeId, viewerId)),
            ),
          ),
        );
      if (pendings.some((p) => p.inviterId === viewerId)) relationship = "outbound";
      else if (pendings.length > 0) relationship = "inbound";
    }
  }

  let mutualFriends: FriendUser[] = [];
  if (targetId !== viewerId) {
    const [mine, theirs] = await Promise.all([friendsOf(viewerId), friendsOf(targetId)]);
    const theirSet = new Set(theirs);
    const sharedIds = mine.filter((id) => theirSet.has(id));
    if (sharedIds.length > 0) {
      const rows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, sharedIds));
      mutualFriends = rows
        .map((u) => ({ userId: u.id, displayName: u.displayName }))
        .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
    }
  }

  if (relationship === "none" && mutualFriends.length === 0) {
    return err(c, "NOT_FOUND", "user not found");
  }

  let profileGames: FriendProfileGame[] | null = null;
  if (relationship === "friends" || relationship === "self") {
    const rows = await db
      .select({ game: games })
      .from(userGames)
      .innerJoin(games, eq(games.id, userGames.gameId))
      .where(eq(userGames.userId, targetId))
      .orderBy(
        sql`${userGames.position} ASC NULLS LAST`,
        asc(userGames.addedAt),
        asc(userGames.gameId),
      );
    const gameIds = rows.map((r) => r.game.id);
    const [scoreRows, viewerGameRows] = await Promise.all([
      gameIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              gameId: gameScores.gameId,
              scoreRaw: gameScores.scoreRaw,
              scoreValue: gameScores.scoreValue,
            })
            .from(gameScores)
            .where(
              and(
                eq(gameScores.userId, targetId),
                eq(gameScores.periodKey, periodKey),
                inArray(gameScores.gameId, gameIds),
              ),
            ),
      db.select({ gameId: userGames.gameId }).from(userGames).where(eq(userGames.userId, viewerId)),
    ]);
    const scoreByGame = new Map(scoreRows.map((s) => [s.gameId, s]));
    const viewerGameIds = new Set(viewerGameRows.map((r) => r.gameId));
    profileGames = rows.map((r) => {
      const score = scoreByGame.get(r.game.id);
      return {
        game: toGameShape(r.game),
        viewerHasGame: viewerGameIds.has(r.game.id),
        score: score
          ? {
              scoreRaw: score.scoreRaw,
              scoreValue: score.scoreValue === null ? null : Number(score.scoreValue),
            }
          : null,
      };
    });
  }

  const response: FriendProfileResponse = {
    user: { userId: target.id, displayName: target.displayName },
    relationship,
    friendsSince,
    mutualFriends,
    periodKey,
    games: profileGames,
  };
  return ok(c, response);
});

// --- DELETE /v1/friends/:userId — unfriend (scores stay, visibility stops) ---

friendRoutes.delete("/:userId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const target = c.req.param("userId");
  if (!UUID_RE.test(target)) return err(c, "NOT_FOUND", "friend not found");
  if (target === userId) return err(c, "VALIDATION", "you can't unfriend yourself");

  await removeFriendship(userId, target);
  return ok(c, { ok: true });
});
