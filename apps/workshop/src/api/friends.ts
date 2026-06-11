// Friends-surface API (spec §3.4/§3.7, G2a/G2b) — the share-link friend graph
// behind the same flag gate as `/v1/games`. Entirely separate from the Lists
// invite wrappers in `invites.ts`; nothing here touches `/v1/lists`.
//
// Unlike the other client wrappers (which trust `apiRequest<T>`), these
// responses are validated with zod before they reach the UI: the friend
// preview endpoint is *unauthenticated* (anyone can hit it with a token), so
// the response is the least-trusted boundary in the games surface — a malformed
// body should surface as a clean error, not a render crash.

import type {
  AcceptFriendRequestResponse,
  FriendInviteResponse,
  FriendProfileResponse,
  FriendRequestPreview,
  FriendRequestsResponse,
  FriendsResponse,
  MutualsResponse,
  SendFriendRequestResponse,
} from "@workshop/shared/friends";
import { z } from "zod";
import { apiRequest } from "../lib/api";

const friendSummarySchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  friendsSince: z.string(),
});

const friendsResponseSchema = z.object({
  friends: z.array(friendSummarySchema),
});

const friendInviteResponseSchema = z.object({
  token: z.string(),
  url: z.string(),
});

const friendRequestPreviewSchema = z.object({
  inviter: z.object({
    userId: z.string(),
    displayName: z.string().nullable(),
  }),
  status: z.enum(["pending", "accepted", "declined"]),
});

const acceptFriendRequestResponseSchema = z.object({
  friend: friendSummarySchema,
});

/** `GET /v1/friends` — my accepted friends, newest edge first. */
export async function fetchFriends(token: string | null): Promise<FriendsResponse> {
  const raw = await apiRequest<unknown>({ method: "GET", path: "/v1/friends", token });
  return friendsResponseSchema.parse(raw);
}

/** `POST /v1/friends/invite` — mint a personal share-link invite. */
export async function createFriendInvite(token: string | null): Promise<FriendInviteResponse> {
  const raw = await apiRequest<unknown>({ method: "POST", path: "/v1/friends/invite", token });
  return friendInviteResponseSchema.parse(raw);
}

/**
 * `GET /v1/friends/requests/:token` — preview who's inviting before accepting.
 * Public on the backend; we still forward the session token when present so a
 * signed-in user shares the same warmed connection.
 */
export async function fetchFriendRequestPreview(
  inviteToken: string,
  token: string | null,
): Promise<FriendRequestPreview> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/friends/requests/${encodeURIComponent(inviteToken)}`,
    token,
  });
  return friendRequestPreviewSchema.parse(raw);
}

/** `POST /v1/friends/requests/:token/accept` — form the symmetric edge. */
export async function acceptFriendRequest(
  inviteToken: string,
  token: string | null,
): Promise<AcceptFriendRequestResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/friends/requests/${encodeURIComponent(inviteToken)}/accept`,
    token,
  });
  return acceptFriendRequestResponseSchema.parse(raw);
}

/** `DELETE /v1/friends/:userId` — unfriend (scores stay, visibility stops). */
export function unfriend(userId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/friends/${encodeURIComponent(userId)}`,
    token,
  });
}

const friendUserSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
});

const friendRequestSummarySchema = friendUserSchema.extend({ requestedAt: z.string() });

const friendRequestsResponseSchema = z.object({
  inbound: z.array(friendRequestSummarySchema),
  outbound: z.array(friendRequestSummarySchema),
});

const sendFriendRequestResponseSchema = z.object({
  status: z.enum(["pending", "accepted"]),
  friend: friendSummarySchema.nullable(),
});

const mutualsResponseSchema = z.object({
  mutuals: z.array(
    friendUserSchema.extend({
      mutualCount: z.number(),
      mutualFriends: z.array(friendUserSchema),
    }),
  ),
});

const profileGameSchema = z.object({
  game: z.object({
    id: z.string(),
    url: z.string(),
    normalizedUrl: z.string(),
    title: z.string(),
    iconUrl: z.string().nullable(),
    gameKey: z.string().nullable(),
    scoreDirection: z.enum(["asc", "desc"]),
    createdAt: z.string(),
  }),
  viewerHasGame: z.boolean(),
  score: z.object({ scoreRaw: z.string(), scoreValue: z.number().nullable() }).nullable(),
});

const friendProfileResponseSchema = z.object({
  user: friendUserSchema,
  relationship: z.enum(["self", "friends", "outbound", "inbound", "none"]),
  friendsSince: z.string().nullable(),
  mutualFriends: z.array(friendUserSchema),
  periodKey: z.string(),
  games: z.array(profileGameSchema).nullable(),
});

/** `GET /v1/friends/requests` — my pending directed requests, both sides. */
export async function fetchFriendRequests(token: string | null): Promise<FriendRequestsResponse> {
  const raw = await apiRequest<unknown>({ method: "GET", path: "/v1/friends/requests", token });
  return friendRequestsResponseSchema.parse(raw);
}

/**
 * `POST /v1/friends/requests` — send a directed request to a user. Comes back
 * `accepted` (with the new friend) when we were already friends or they had
 * already requested me.
 */
export async function sendFriendRequest(
  userId: string,
  token: string | null,
): Promise<SendFriendRequestResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: "/v1/friends/requests",
    token,
    body: { userId },
  });
  return sendFriendRequestResponseSchema.parse(raw);
}

/** `POST /v1/friends/requests/user/:userId/accept` — accept their request. */
export async function acceptFriendRequestFrom(
  userId: string,
  token: string | null,
): Promise<AcceptFriendRequestResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/friends/requests/user/${encodeURIComponent(userId)}/accept`,
    token,
  });
  return acceptFriendRequestResponseSchema.parse(raw);
}

/**
 * `DELETE /v1/friends/requests/user/:userId` — cancel my outbound request to
 * them, or silently deny their inbound one (same verb on the backend).
 */
export function removeFriendRequest(userId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/friends/requests/user/${encodeURIComponent(userId)}`,
    token,
  });
}

/** `GET /v1/friends/mutuals` — friends of friends, most-connected first. */
export async function fetchMutuals(token: string | null): Promise<MutualsResponse> {
  const raw = await apiRequest<unknown>({ method: "GET", path: "/v1/friends/mutuals", token });
  return mutualsResponseSchema.parse(raw);
}

/** `GET /v1/friends/users/:userId?period=` — viewer-relative profile. */
export async function fetchFriendProfile(
  userId: string,
  periodKey: string,
  token: string | null,
): Promise<FriendProfileResponse> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/friends/users/${encodeURIComponent(userId)}?period=${encodeURIComponent(periodKey)}`,
    token,
  });
  return friendProfileResponseSchema.parse(raw);
}
