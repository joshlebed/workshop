// What a score post does for spike #10 (friend streaks + weekly quests). Both
// score write paths — the legacy `PUT /v1/games/:id/scores` handler and teach's
// `handleScoreUpsertV2` — call this after the row is saved. Best-effort: each
// half swallows its own errors, so it can never fail the post.

import { completeQuestsAfterPost } from "./friendQuests.js";
import { recordKeepalivePost } from "./friendStreaks.js";
import { isNudgeablePeriod } from "./nudges.js";

export async function afterFriendScorePost(userId: string, periodKey: string): Promise<void> {
  // "Keep it alive" is about today; a late paste for an old day isn't one.
  if (isNudgeablePeriod(periodKey)) await recordKeepalivePost(userId, periodKey);
  await completeQuestsAfterPost(userId, periodKey);
}
