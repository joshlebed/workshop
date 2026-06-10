// Friends surface (spec §3.4, G2a) — shared types for the symmetric friend
// graph + share-link invites. Type-only module exported via the `./friends`
// subpath (like `./games`): the barrel's `.js` re-exports don't resolve under
// Metro, so the client imports this file directly.

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
