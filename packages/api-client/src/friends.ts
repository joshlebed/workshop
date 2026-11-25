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
  FriendQuestsResponse,
  FriendRequestPreview,
  FriendRequestsResponse,
  FriendsResponse,
  HeadToHeadRange,
  HeadToHeadResponse,
  MutualsResponse,
  SendFriendRequestResponse,
} from "@workshop/shared/friends";
import { safeParseScoreSpec } from "@workshop/shared/scoreParsing";
import { safeParseSummarySpec } from "@workshop/shared/summarySpec";
import { z } from "zod";
import { apiRequest } from "./api";

const friendStreakSchema = z.object({
  days: z.number(),
  viewerPostedToday: z.boolean(),
  friendPostedToday: z.boolean(),
});

const friendSummarySchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  friendsSince: z.string(),
  // Absent from backends before spike #10 (and from accept/request replies).
  streak: friendStreakSchema.optional(),
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
  // Optional for a backend that predates the field; absent reads as "not friends".
  viewerIsFriend: z.boolean().default(false),
});

const acceptFriendRequestResponseSchema = z.object({
  friend: friendSummarySchema,
});

/**
 * `GET /v1/friends` — my accepted friends, newest edge first. `today` (my local
 * date) anchors each friend's pair streak; without it the server uses UTC.
 */
export async function fetchFriends(token: string | null, today?: string): Promise<FriendsResponse> {
  const path = today ? `/v1/friends?today=${encodeURIComponent(today)}` : "/v1/friends";
  const raw = await apiRequest<unknown>({ method: "GET", path, token });
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

const gameSchema = z.object({
  id: z.string(),
  url: z.string(),
  normalizedUrl: z.string(),
  title: z.string(),
  iconUrl: z.string().nullable(),
  gameKey: z.string().nullable(),
  scoreDirection: z.enum(["asc", "desc"]),
  scoreUnit: z.enum(["seconds"]).nullable().optional(),
  // Validated into a ScoreSpec (or null) so the parsed type matches `Game`.
  scoreSpec: z.unknown().transform((v) => safeParseScoreSpec(v)),
  summarySpec: z.unknown().transform((v) => safeParseSummarySpec(v)),
  createdAt: z.string(),
});

const profileGameSchema = z.object({
  game: gameSchema,
  viewerHasGame: z.boolean(),
  score: z
    .object({
      scoreRaw: z.string(),
      scoreValue: z.number().nullable(),
      // Present only on scores the server parsed with stored game code.
      parseStatus: z.enum(["score", "no_result", "failed"]).optional(),
      scoreSummary: z.string().nullable().optional(),
    })
    .nullable(),
});

const friendProfileResponseSchema = z.object({
  user: friendUserSchema,
  relationship: z.enum(["self", "friends", "outbound", "inbound", "none"]),
  friendsSince: z.string().nullable(),
  mutualFriends: z.array(friendUserSchema),
  periodKey: z.string(),
  games: z.array(profileGameSchema).nullable(),
  streak: friendStreakSchema.nullable().optional(),
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
  options: {
    /**
     * A play-link token (`/g/:token`) the target minted. The backend treats
     * holding it like holding their invite link and forms the friendship
     * immediately (`accepted`) instead of leaving a `pending` request.
     */
    via?: string;
  } = {},
): Promise<SendFriendRequestResponse> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: "/v1/friends/requests",
    token,
    body: options.via ? { userId, via: options.via } : { userId },
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

/**
 * `GET /v1/friends/users/:userId?period=` — viewer-relative profile. `via` is
 * an optional play-link token (`/g/:token`): when the viewer has no relationship
 * and no mutuals, a valid token for this user vouches them past the anti-probe
 * 404 so a play-link recipient can still see who they are and add them.
 */
export async function fetchFriendProfile(
  userId: string,
  periodKey: string,
  token: string | null,
  via?: string,
): Promise<FriendProfileResponse> {
  const params = new URLSearchParams({ period: periodKey });
  if (via) params.set("via", via);
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/friends/users/${encodeURIComponent(userId)}?${params.toString()}`,
    token,
  });
  return friendProfileResponseSchema.parse(raw);
}

const headToHeadSideSchema = z.object({
  plays: z.number(),
  averageScore: z.number().nullable(),
});

const headToHeadResponseSchema = z.object({
  friend: friendUserSchema,
  range: z.enum(["7", "30", "all"]),
  from: z.string().nullable(),
  to: z.string(),
  games: z.array(
    z.object({
      game: gameSchema,
      viewer: headToHeadSideSchema,
      friend: headToHeadSideSchema,
      sharedDays: z.number(),
      wins: z.number(),
      losses: z.number(),
      ties: z.number(),
      days: z.array(
        z.object({
          periodKey: z.string(),
          outcome: z.enum(["win", "loss", "tie", "none"]),
          viewerScore: z.number().nullable(),
          friendScore: z.number().nullable(),
        }),
      ),
    }),
  ),
});

/**
 * `GET /v1/friends/users/:userId/head-to-head` — me vs. one friend, per game
 * we both played in the range ending on `today` (my local date). 404 unless
 * we are friends.
 */
export async function fetchHeadToHead(
  userId: string,
  range: HeadToHeadRange,
  today: string,
  token: string | null,
): Promise<HeadToHeadResponse> {
  const params = new URLSearchParams({ range, today });
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/friends/users/${encodeURIComponent(userId)}/head-to-head?${params.toString()}`,
    token,
  });
  return headToHeadResponseSchema.parse(raw);
}

const friendQuestSchema = z.object({
  friend: friendUserSchema,
  weekStart: z.string(),
  weekEnd: z.string(),
  target: z.number(),
  count: z.number(),
  viewerCount: z.number(),
  friendCount: z.number(),
  completedAt: z.string().nullable(),
  celebrate: z.boolean(),
});

const friendQuestsResponseSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  quests: z.array(friendQuestSchema),
  celebrations: z.array(friendQuestSchema),
});

/**
 * `GET /v1/friends/quests?today=` — this week's cooperative quests (generated
 * on the first read of the week) plus completed ones still to celebrate.
 */
export async function fetchFriendQuests(
  today: string,
  token: string | null,
): Promise<FriendQuestsResponse> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/friends/quests?today=${encodeURIComponent(today)}`,
    token,
  });
  return friendQuestsResponseSchema.parse(raw);
}

/** `POST /v1/friends/quests/seen` — the viewer has seen one quest's celebration. */
export function markFriendQuestSeen(
  friendId: string,
  weekStart: string,
  token: string | null,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "POST",
    path: "/v1/friends/quests/seen",
    token,
    body: { friendId, weekStart },
  });
}
