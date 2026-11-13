// Nudge rules for the per-game board, kept pure so they are testable without
// a renderer. The server authors the state (`GameLeaderboardResponse.nudges`);
// this only turns it into what a row and the footer show.

import type { GameNudgeState } from "@workshop/shared/games";

/**
 * Every friend on the board gets the hand once the viewer has played; what a
 * tap does depends on the status.
 * - `hidden`: no control (the viewer hasn't played, or it's a past day).
 * - `available`: tap to send.
 * - `sent`: already sent on this game today.
 * - `unreachable`: the friend has no device registered for notifications. A
 *   tap says so, so the viewer can tell them to turn notifications on.
 * - `spent`: today's allowance is used up. A tap says so.
 */
export type NudgeRowStatus = "hidden" | "available" | "sent" | "unreachable" | "spent";

export function nudgeRowStatus(
  state: GameNudgeState | null | undefined,
  userId: string,
): NudgeRowStatus {
  if (!state) return "hidden";
  if (state.nudgedUserIds.includes(userId)) return "sent";
  if (!state.reachableUserIds.includes(userId)) return "unreachable";
  if (state.remaining !== null && state.remaining <= 0) return "spent";
  return "available";
}

/**
 * The footer line under the board — the one place that says what the bare
 * hand on each row does. Null when there is nobody to poke.
 */
export function nudgeAllowanceLabel(
  state: GameNudgeState | null | undefined,
  friendCount: number,
): string | null {
  if (!state || friendCount === 0) return null;
  if (state.remaining !== null && state.remaining <= 0) return "No pokes left today";
  return `Poke a friend · ${state.remaining ?? "∞"} left today`;
}

/**
 * Why the viewer can't poke yet: sending needs notifications on this side
 * too. Keyed by what asking the device for them came back with.
 */
export function pokeBlockedMessage(
  readiness: "denied" | "dismissed" | "unsupported" | "outdated" | "sender_unreachable",
): string {
  // An installed app too old to have notifications: updating is the fix.
  if (readiness === "outdated") {
    return "Update HighScore from the App Store and enable notifications to send pokes";
  }
  if (readiness === "denied") {
    return "Turn on notifications for HighScore in Settings to poke friends";
  }
  if (readiness === "unsupported") {
    return "Download the HighScore iPhone app and enable notifications to send pokes";
  }
  return "Turn on notifications to poke friends";
}

/** The friend can't be poked until they turn notifications on. */
export function friendUnreachableMessage(name: string): string {
  return `${name} doesn't have push notifications. They need to enable notifications to receive pokes.`;
}

/** The toast for a send the server refused. */
export function nudgeRefusalMessage(reason: unknown, name: string, fallback: string): string {
  if (reason === "unreachable") return friendUnreachableMessage(name);
  if (reason === "sender_unreachable") return pokeBlockedMessage("sender_unreachable");
  return fallback;
}

/** The state after a successful nudge to `userId`, for the cached board. */
export function withNudgeSent(
  state: GameNudgeState,
  userId: string,
  server: Pick<GameNudgeState, "limit" | "remaining">,
): GameNudgeState {
  return {
    ...state,
    limit: server.limit,
    remaining: server.remaining,
    nudgedUserIds: state.nudgedUserIds.includes(userId)
      ? state.nudgedUserIds
      : [...state.nudgedUserIds, userId],
  };
}
