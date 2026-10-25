import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type PreviewAnswer, previewSharedScore, type SharePreviewAnswer } from "../api/teach";
import { useGamesRuntime } from "../runtime";
import { settleDelayMs } from "./scorePicker";
import { useTeachAvailable } from "./useScoreCheck";

/**
 * The share flow's preview for a teach account: which game the text is a
 * score for, and what posting it there would record — one request.
 * `undefined` while it is out (and always for an account without teach, which
 * keeps using recognition and the registry detection); `null` when it failed.
 *
 * The preview it carries is written into `useScoreCheck`'s cache under the
 * recognised game before this resolves, so the detected-score card's check
 * finds its answer already there and makes no request of its own.
 */
export function useSharePreview(
  text: string,
  periodKey: string,
): SharePreviewAnswer | null | undefined {
  const { token } = useGamesRuntime();
  const available = useTeachAvailable();
  const queryClient = useQueryClient();
  const trimmed = text.trim();
  const [settled, setSettled] = useState(trimmed);
  // Starts empty so the shared payload the screen opens with counts as a
  // paste and is asked about at once; only typing is debounced.
  const lastText = useRef("");
  useEffect(() => {
    const delay = settleDelayMs(lastText.current, trimmed);
    lastText.current = trimmed;
    const timer = setTimeout(() => setSettled(trimmed), delay);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const enabled = available && !!token && settled.length > 0;
  const query = useQuery({
    queryKey: ["game-share-preview", periodKey, settled],
    queryFn: async ({ signal }) => {
      const answer = await previewSharedScore({ scoreRaw: settled, periodKey }, token, signal);
      // Seed the per-game check synchronously with the answer, so the check
      // query that turns on when the match is known starts from a fresh
      // cache entry instead of racing this effect with its own fetch.
      if (answer?.kind === "preview" && answer.match && answer.preview) {
        const seeded: PreviewAnswer = { kind: "preview", preview: answer.preview };
        queryClient.setQueryData(
          ["game-score-check", answer.match.game.id, periodKey, settled],
          (existing: PreviewAnswer | null | undefined) => existing ?? seeded,
        );
      }
      return answer;
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  if (!enabled || settled !== trimmed || query.isPending) return undefined;
  return query.data ?? null;
}
