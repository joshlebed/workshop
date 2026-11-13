// Nudge rules for the per-game board, kept pure so they are testable without
// a renderer. The server authors the state (`GameLeaderboardResponse.nudges`);
// this only turns it into what a row and the footer show.

import type { GameNudgeState } from "@workshop/shared/games";

/**
 * - `hidden`: no control (the viewer hasn't played, it's a past day, or the
 *   friend has no device to be poked on).
 * - `available`: tap to send.
 * - `sent`: already sent on this game today.
 * - `spent`: today's allowance is used up. The control stays and a tap says so.
 */
export type NudgeRowStatus = "hidden" | "available" | "sent" | "spent";

export function nudgeRowStatus(
  state: GameNudgeState | null | undefined,
  userId: string,
): NudgeRowStatus {
  if (!state) return "hidden";
  if (state.nudgedUserIds.includes(userId)) return "sent";
  if (!state.reachableUserIds.includes(userId)) return "hidden";
  if (state.remaining !== null && state.remaining <= 0) return "spent";
  return "available";
}

/**
 * The footer line under the board — the one place that says what the bare
 * hand on each row does. Null when there is nobody to poke.
 */
export function nudgeAllowanceLabel(state: GameNudgeState | null | undefined): string | null {
  if (!state) return null;
  if (state.reachableUserIds.length === 0 && state.nudgedUserIds.length === 0) return null;
  if (state.remaining !== null && state.remaining <= 0) return "No pokes left today";
  return `Poke a friend · ${state.remaining ?? "∞"} left today`;
}

/**
 * Why the viewer can't poke yet: sending needs notifications on this side
 * too. Keyed by what asking the device for them came back with.
 */
export function pokeBlockedMessage(
  readiness: "denied" | "dismissed" | "unsupported" | "sender_unreachable",
): string {
  if (readiness === "denied") {
    return "Turn on notifications for HighScore in Settings to poke friends";
  }
  if (readiness === "unsupported") {
    return "Poking needs notifications on in the HighScore iPhone app";
  }
  return "Turn on notifications to poke friends";
}

/** The toast for a send the server refused. */
export function nudgeRefusalMessage(reason: unknown, name: string, fallback: string): string {
  if (reason === "unreachable") return `${name} hasn't enabled HighScore notifications`;
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
