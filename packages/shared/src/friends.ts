// Friends surface (spec §3.4, G2a) — shared types for the symmetric friend
// graph + share-link invites. Type-only module exported via the `./friends`
// subpath (like `./games`): the barrel's `.js` re-exports don't resolve under
// Metro, so the client imports this file directly.

import type { Game } from "./games.js";

/** One friend edge as seen from the viewer's side. */
export interface FriendSummary {
  userId: string;
  displayName: string | null;
  /** When the friendship edge was created (ISO). */
  friendsSince: string;
}

/** `GET /v1/friends` */
export interface FriendsResponse {
  friends: FriendSummary[];
}

/** `POST /v1/friends/invite` — a personal share-link invite. */
export interface FriendInviteResponse {
  token: string;
  url: string;
}

export type FriendRequestStatus = "pending" | "accepted" | "declined";

/** `GET /v1/friends/requests/:token` — preview the inviter before accepting. */
export interface FriendRequestPreview {
  inviter: {
    userId: string;
    displayName: string | null;
  };
  status: FriendRequestStatus;
}

/** `POST /v1/friends/requests/:token/accept` */
export interface AcceptFriendRequestResponse {
  friend: FriendSummary;
}

/** A user reference on the friends surface (requests, mutuals, profile). */
export interface FriendUser {
  userId: string;
  displayName: string | null;
}

/** One directed pending friend request, as seen from either side. */
export interface FriendRequestSummary extends FriendUser {
  /** When the request was sent (ISO). */
  requestedAt: string;
}

/** `GET /v1/friends/requests` — my pending directed requests. */
export interface FriendRequestsResponse {
  /** Requests other users sent me (accept/deny). */
  inbound: FriendRequestSummary[];
  /** Requests I sent that are still pending (cancel). */
  outbound: FriendRequestSummary[];
}

/**
 * `POST /v1/friends/requests` — send a directed request. `accepted` when the
 * target had already requested me (cross-requests auto-accept) or we were
 * already friends; `friend` is set iff `status === "accepted"`.
 */
export interface SendFriendRequestResponse {
  status: "pending" | "accepted";
  friend: FriendSummary | null;
}

/** One friend-of-friend suggestion. */
export interface MutualSummary extends FriendUser {
  /** Number of my friends who are friends with this person. */
  mutualCount: number;
  /** Which of my friends know them (social proof — all already my friends). */
  mutualFriends: FriendUser[];
}

/** `GET /v1/friends/mutuals` — friends of friends, most-connected first. */
export interface MutualsResponse {
  mutuals: MutualSummary[];
}

/** Viewer ↔ profile-subject relationship state. */
export type FriendshipState = "self" | "friends" | "outbound" | "inbound" | "none";

/** One game on a friend's profile, with their score for the viewed period. */
export interface FriendProfileGame {
  game: Game;
  /** Whether the viewer already has this game in My Games (gates quick-add). */
  viewerHasGame: boolean;
  /** The profile subject's score for `periodKey`; null when unplayed. */
  score: { scoreRaw: string; scoreValue: number | null } | null;
}

/** `GET /v1/friends/users/:userId` */
export interface FriendProfileResponse {
  user: FriendUser;
  relationship: FriendshipState;
  /** Set iff `relationship === "friends"`. */
  friendsSince: string | null;
  /** My friends who are also their friends. */
  mutualFriends: FriendUser[];
  periodKey: string;
  /** Their games; null unless `relationship` is `friends` or `self`. */
  games: FriendProfileGame[] | null;
}
