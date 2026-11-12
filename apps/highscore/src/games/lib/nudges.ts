// Nudge rules for the per-game board, kept pure so they are testable without
// a renderer. The server authors the state (`GameLeaderboardResponse.nudges`);
// this only turns it into what a row and the footer show.

import type { GameNudgeState } from "@workshop/shared/games";

/**
 * - `hidden`: no control (the viewer hasn't played, or it's a past day).
 * - `available`: tap to send. Shown for every friend on the board; a friend
 *   with notifications off is only discovered on the tap (`unreachable`).
 * - `sent`: already sent on this game today.
 * - `spent`: today's allowance is used up.
 */
export type NudgeRowStatus = "hidden" | "available" | "sent" | "spent";

export function nudgeRowStatus(
  state: GameNudgeState | null | undefined,
  userId: string,
): NudgeRowStatus {
  if (!state) return "hidden";
  if (state.nudgedUserIds.includes(userId)) return "sent";
  if (state.remaining !== null && state.remaining <= 0) return "spent";
  return "available";
}

/**
 * The footer line under the board — the one place that says what the bare
 * bolt on each row does. Null when there is no friend to send one to.
 */
export function nudgeAllowanceLabel(
  state: GameNudgeState | null | undefined,
  friendCount: number,
): string | null {
  if (!state || friendCount === 0) return null;
  if (state.remaining === null) return "Ping a friend to come see the board";
  if (state.remaining <= 0) return "No pings left today";
  return `Ping a friend to come see the board · ${state.remaining} left today`;
}

/** The toast for a refused send; `unreachable` names the friend. */
export function nudgeRefusalMessage(reason: unknown, name: string, fallback: string): string {
  if (reason === "unreachable") return `${name} hasn't enabled HighScore notifications`;
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
