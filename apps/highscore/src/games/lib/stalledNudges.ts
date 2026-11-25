// Spike 4, kept pure so the copy is unit-tested: the one-tap "Nudge Sam,
// Riley — they haven't played yet" row in the posted-score notice, what it
// says after sending, and the home card's "Sam & Riley played — your turn".
// The server decides who can be nudged (`UpsertGameScoreResponse.stalledFriends`)
// and judges each send; this only turns its answers into words.

import type { SendStalledNudgesResponse, StalledFriendsNudge } from "@workshop/shared/games";

const nameOf = (displayName: string | null | undefined) => displayName?.trim() || "A friend";

/** "Sam" · "Sam, Riley" · "Sam, Riley + 2 more". */
function shortList(names: string[], joiner: string): string {
  const [a, b] = names;
  if (names.length <= 1) return a ?? "";
  if (names.length === 2) return `${a}${joiner}${b}`;
  return `${a}, ${b} + ${names.length - 2} more`;
}

function leftLabel(remaining: number | null): string {
  if (remaining === null) return "";
  return ` · ${remaining} ${remaining === 1 ? "nudge" : "nudges"} left today`;
}

export interface StalledNudgeOffer {
  message: string;
  actionLabel: string;
  /** Who one tap nudges: everyone offered, cut to the allowance. */
  recipients: { userId: string; displayName: string | null }[];
}

/** The toast after posting when friends on the game haven't played yet; null = nothing to offer. */
export function stalledNudgeOffer(
  stalled: StalledFriendsNudge | null | undefined,
  posted: string,
): StalledNudgeOffer | null {
  if (!stalled || stalled.friends.length === 0) return null;
  if (stalled.remaining !== null && stalled.remaining <= 0) return null;
  const recipients =
    stalled.remaining === null ? stalled.friends : stalled.friends.slice(0, stalled.remaining);
  const names = shortList(
    recipients.map((f) => nameOf(f.displayName)),
    ", ",
  );
  return {
    message: `${posted}. Nudge ${names} — they haven't played yet${leftLabel(stalled.remaining)}`,
    actionLabel: "Nudge",
    recipients,
  };
}

/** What the toast says once the nudges went out (or didn't). */
export function stalledNudgeResult(
  result: SendStalledNudgesResponse,
  recipients: { userId: string; displayName: string | null }[],
): { message: string; tone: "success" | "danger" | "default" } {
  const nameById = new Map(recipients.map((f) => [f.userId, nameOf(f.displayName)]));
  const nudged = result.nudged.map((id) => nameById.get(id) ?? "A friend");
  if (nudged.length > 0) {
    const missed = result.refused.length;
    return {
      message: `Nudged ${shortList(nudged, " and ")}${leftLabel(result.remaining)}${
        missed > 0 ? ` · ${missed} couldn't be nudged` : ""
      }`,
      tone: "success",
    };
  }
  if (result.refused.some((r) => r.reason === "daily_limit")) {
    return { message: "You're out of nudges for today", tone: "default" };
  }
  if (result.refused.every((r) => r.reason === "friend_already_played")) {
    return { message: "They've played since — check the board", tone: "default" };
  }
  return { message: "Couldn't send those nudges", tone: "danger" };
}

/**
 * The home card line for a game friends posted today and the viewer hasn't:
 * "Sam played — your turn", "Sam & Riley played — your turn",
 * "Sam, Riley + 2 more played — your turn". Null when nobody has.
 */
export function friendsWaitingLine(
  entries: { userId: string; displayName: string | null }[],
  selfId: string | null,
): string | null {
  const names = entries.filter((e) => e.userId !== selfId).map((e) => nameOf(e.displayName));
  if (names.length === 0) return null;
  return `${shortList(names, " & ")} played — your turn`;
}
