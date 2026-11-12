// Nudge rules for the per-game board, kept pure so they are testable without
// a renderer. The server authors the state (`GameLeaderboardResponse.nudges`);
// this only turns it into what a row and the footer show.

import type { GameNudgeState } from "@workshop/shared/games";

/**
 * - `hidden`: no nudge control (no state, or the friend has no device).
 * - `available`: tap to nudge.
 * - `sent`: already nudged on this game today.
 * - `spent`: today's allowance is used up.
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

/** The footer line under the board; null when there is nobody to nudge. */
export function nudgeAllowanceLabel(state: GameNudgeState | null | undefined): string | null {
  if (!state) return null;
  if (state.reachableUserIds.length === 0 && state.nudgedUserIds.length === 0) return null;
  if (state.remaining === null) return "Unlimited nudges";
  if (state.remaining <= 0) return "No nudges left today";
  return `${state.remaining} of ${state.limit ?? state.remaining} nudges left today`;
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
