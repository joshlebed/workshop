import { errorMessage } from "@workshop/api-client/api";
import { haptics } from "@workshop/ui";
import { useCallback } from "react";
import { useToast } from "../../theme";
import { createGameChallenge } from "../api/games";
import { challengeShareText } from "../lib/challenge";
import { prewarmGameShareCard } from "../lib/prewarmShareCard";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

/**
 * "Challenge a friend": mint (or reuse) my challenge link for this game and
 * day, pre-warm its OG card, then hand "I got 937 on today's MapTap. Beat me:
 * <link>" to the share sheet (native) or the clipboard (web). Used by the
 * posted-score toast and my own row on the board.
 */
export function useChallengeFriend(): (gameId: string, periodKey: string) => Promise<void> {
  const { token } = useGamesRuntime();
  const { showToast } = useToast();
  return useCallback(
    async (gameId: string, periodKey: string) => {
      try {
        const challenge = await createGameChallenge(gameId, periodKey, token);
        prewarmGameShareCard(challenge.url);
        haptics.light();
        const result = await shareOrCopyLink(
          challengeShareText({
            display: challenge.score.display,
            gameTitle: challenge.gameTitle,
            url: challenge.url,
          }),
        );
        if (result === "copied") {
          showToast({ message: "Challenge copied — paste it to a friend", tone: "success" });
        } else if (result === "failed") {
          showToast({ message: `Couldn't copy. Your link: ${challenge.url}`, tone: "danger" });
        }
      } catch (e) {
        showToast({ message: errorMessage(e, "Couldn't create a challenge"), tone: "danger" });
      }
    },
    [showToast, token],
  );
}
