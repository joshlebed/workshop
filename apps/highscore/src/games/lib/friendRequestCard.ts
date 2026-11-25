// The Games-home "Sam wants to be friends" card (onboarding spike #7): which
// inbound request it shows, and what dismissing writes. Pure, so the rules
// are tested without a renderer.
//
// The card shows the newest live inbound request. Its X only hides the card
// (it never declines — decline stays an explicit button) and stores which
// request was dismissed in the `friends.request-card` user flag, so the same
// request never comes back on this or another device while a newer request
// brings the card back.

import type { FriendRequestSummary } from "@workshop/shared/friends";

export interface FriendRequestCardFlag {
  userId: string;
  requestedAt: string;
  dismissedAt: string;
}

function isCardFlag(value: unknown): value is FriendRequestCardFlag {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === "string" && typeof v.requestedAt === "string";
}

/** The request the card shows, or null (no requests / newest already dismissed). */
export function friendRequestCardTarget(
  inbound: FriendRequestSummary[],
  flag: unknown,
): FriendRequestSummary | null {
  let newest: FriendRequestSummary | null = null;
  for (const request of inbound) {
    if (!newest || request.requestedAt > newest.requestedAt) newest = request;
  }
  if (!newest) return null;
  if (
    isCardFlag(flag) &&
    flag.userId === newest.userId &&
    flag.requestedAt === newest.requestedAt
  ) {
    return null;
  }
  return newest;
}

export function dismissedRequestCardValue(
  request: FriendRequestSummary,
  now: Date,
): FriendRequestCardFlag {
  return {
    userId: request.userId,
    requestedAt: request.requestedAt,
    dismissedAt: now.toISOString(),
  };
}

/** "Sam wants to be friends" — with how many more are waiting, if any. */
export function friendRequestCardCopy(
  request: FriendRequestSummary,
  total: number,
): { title: string; detail: string } {
  const name = request.displayName?.trim() || "Someone";
  const more = total - 1;
  return {
    title: `${name} wants to be friends`,
    detail:
      more > 0
        ? `+${more} more ${more === 1 ? "request" : "requests"} in Friends`
        : "Accept to see each other's scores",
  };
}
