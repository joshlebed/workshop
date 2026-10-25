// What to tell the player about a score that was posted before (or without)
// its preview: the server's post-hoc `check`, turned into the one toast the
// post shows. A wrong-game match comes first — it is the one with a
// consequence — then a same-text day. Pure; `usePostedScoreNotice` wires the
// actions.

import type { PostedScoreCheck } from "@workshop/shared/games";
import { formatGameDateLabel } from "./gameDate";

export type PostedCheckNotice =
  | {
      kind: "wrong_game";
      message: string;
      actionLabel: "Move";
      other: { id: string; title: string };
    }
  | { kind: "same_text"; message: string; actionLabel: "Undo" };

/** The notice for a post's `check`, or null when there is nothing to say. */
export function postedCheckNotice(
  check: PostedScoreCheck | undefined,
  today: string,
): PostedCheckNotice | null {
  if (!check) return null;
  if (check.wrongGame) {
    const { game } = check.wrongGame;
    return {
      kind: "wrong_game",
      message: `Posted. Looks like a ${game.title} score, though.`,
      actionLabel: "Move",
      other: { id: game.id, title: game.title },
    };
  }
  if (check.sameTextPeriodKey) {
    const label = formatGameDateLabel(check.sameTextPeriodKey, today);
    const when = label === "Yesterday" || label === "Today" ? label.toLowerCase() : `on ${label}`;
    return {
      kind: "same_text",
      message: `Posted. You posted this same result ${when}.`,
      actionLabel: "Undo",
    };
  }
  return null;
}
