// Pure helper for the post-accept "People you both know" step (no RN imports
// so vitest can load it).

import type { MutualSummary } from "@workshop/shared/friends";

/**
 * The new friend's friends that the mutuals feed (`GET /v1/friends/mutuals`,
 * friends-of-friends ranked by connections) vouches through *this* friend —
 * i.e. the people you both know, in feed order.
 */
export function mutualsVia(mutuals: readonly MutualSummary[], friendId: string): MutualSummary[] {
  return mutuals.filter((m) => m.mutualFriends.some((f) => f.userId === friendId));
}
