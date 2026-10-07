import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type PreviewAnswer, previewSharedScore, type SharePreviewAnswer } from "../api/teach";
import { useGamesRuntime } from "../runtime";
import { useTeachAvailable } from "./useScoreCheck";

// Typing settles before we ask; a shared payload (the usual input) waits this once.
const DEBOUNCE_MS = 300;

/**
 * The share flow's preview for a teach account: which game the text is a
 * score for, and what posting it there would record — one request. Null
 * while it is out, when it fails, and always for an account without teach
 * (which keeps using recognition and the registry detection).
 *
 * The preview it carries is also handed to `useScoreCheck`'s cache under the
 * recognised game, so the detected-score card shows it without asking again.
 */
export function useSharePreview(text: string, periodKey: string): SharePreviewAnswer | null {
  const { token } = useGamesRuntime();
  const available = useTeachAvailable();
  const queryClient = useQueryClient();
  const trimmed = text.trim();
  const [settled, setSettled] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const enabled = available && !!token && settled.length > 0;
  const query = useQuery({
    queryKey: ["game-share-preview", periodKey, settled],
    queryFn: ({ signal }) => previewSharedScore({ scoreRaw: settled, periodKey }, token, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const answer = enabled && settled === trimmed ? (query.data ?? null) : null;

  useEffect(() => {
    if (answer?.kind !== "preview" || !answer.match || !answer.preview) return;
    const seeded: PreviewAnswer = { kind: "preview", preview: answer.preview };
    queryClient.setQueryData(
      ["game-score-check", answer.match.game.id, periodKey, settled],
      (existing: PreviewAnswer | null | undefined) => existing ?? seeded,
    );
  }, [answer, periodKey, settled, queryClient]);

  return answer;
}
