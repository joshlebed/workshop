import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import type { UpsertGameScoreResponse } from "@workshop/shared/games";
import { useCallback } from "react";
import { usePlayReminderOffer } from "../../components/PlayReminderPrompt";
import { useToast } from "../../theme";
import { clearGameScore, upsertGameScore } from "../api/games";
import { postedCheckNotice } from "../lib/postedCheck";
import { useGamesRuntime } from "../runtime";

/** How long a toast with something to do on it stays up. */
const NOTICE_DURATION_MS = 8000;

export interface PostedScoreInput {
  result: UpsertGameScoreResponse;
  gameId: string;
  periodKey: string;
  scoreRaw: string;
  /** The local day, for "yesterday" in the same-text notice. */
  today: string;
  /** The plain success message when there is nothing to add. */
  posted: string;
}

/**
 * The toast after a score post. Usually just "Score posted"; when the post
 * came back with a `check` — it was made before its preview could say
 * anything — the toast carries the preview's advice and the one action that
 * answers it: **Move** the score to the game it looks like, or **Undo** a
 * repeat of another day's result. Either runs against the row already
 * saved, so a tap that fails leaves the post as it was and says so.
 */
export function usePostedScoreNotice(): (input: PostedScoreInput) => void {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // Every post surface lands here on success — the one place the daily-nudge
  // pre-prompt is offered (once per session; it decides whether to show).
  const offerReminder = usePlayReminderOffer();

  return useCallback(
    ({ result, gameId, periodKey, scoreRaw, today, posted }: PostedScoreInput) => {
      offerReminder();
      const notice = postedCheckNotice(result.check, today);
      if (!notice) {
        showToast({ message: posted, tone: "success" });
        return;
      }
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["games"] });
      const onAction =
        notice.kind === "wrong_game"
          ? async () => {
              try {
                await upsertGameScore(
                  notice.other.id,
                  {
                    periodKey,
                    scoreRaw,
                    previewSeen: true,
                    wrongGame: { gameId, choice: "there" },
                  },
                  token,
                );
                await clearGameScore(gameId, periodKey, token);
                void refresh();
                showToast({ message: `Moved to ${notice.other.title}`, tone: "success" });
              } catch (e) {
                void refresh();
                showToast({ message: errorMessage(e, "Couldn't move the score"), tone: "danger" });
              }
            }
          : async () => {
              try {
                await clearGameScore(gameId, periodKey, token);
                void refresh();
                showToast({ message: "Score removed", tone: "success" });
              } catch (e) {
                showToast({
                  message: errorMessage(e, "Couldn't remove the score"),
                  tone: "danger",
                });
              }
            };
      showToast({
        message: notice.message,
        tone: "success",
        durationMs: NOTICE_DURATION_MS,
        actionLabel: notice.actionLabel,
        onAction: () => void onAction(),
      });
    },
    [offerReminder, queryClient, showToast, token],
  );
}
