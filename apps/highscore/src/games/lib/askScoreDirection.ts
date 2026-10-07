import type { GameScoreDirection } from "@workshop/shared/games";
import { confirm } from "@workshop/ui";
import type { AskDirection } from "./teachAfterPost";

/**
 * The after-the-post question for a first teach whose picker could not ask:
 * "is a lower score better?". A yes/no so it reads the same on web (where the
 * dialog only has OK / Cancel) and on native (where the buttons are labelled).
 * `suggested` decides nothing — it is only which answer the default button is.
 */
export function askScoreDirection(gameTitle: string): AskDirection {
  return async (_suggested: GameScoreDirection | null) => {
    const lower = await confirm({
      title: `In ${gameTitle}, is a lower score better?`,
      message: "This sets how everyone's scores are ranked. OK for lower, Cancel for higher.",
      confirmLabel: "Lower is better",
      cancelLabel: "Higher is better",
    });
    return lower ? "asc" : "desc";
  };
}
