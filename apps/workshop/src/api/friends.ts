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
  FriendRequestPreview,
  FriendsResponse,
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
 * `POST /v1/friends/invite/reset` — rotate my invite link. The old URL stops
 * working (preview + accept 404) and a fresh one is minted in its place.
 */
export async function resetFriendInvite(token: string | null): Promise<FriendInviteResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: "/v1/friends/invite/reset",
    token,
  });
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
