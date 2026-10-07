import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useGamesRuntime } from "../runtime";
import {
  codeParsingAvailable,
  type ServerScorePreview,
  scorePreviewOffered,
  scorePreviewQueryOptions,
  serverScorePreviewState,
} from "./scorePreview";

// Typing settles before we ask; a paste (the usual input) waits this once.
const DEBOUNCE_MS = 300;

/**
 * What the server would store if `text` were posted to this game. Nothing
 * waits on this. The decisions — who is asked, how, and what each state
 * means — are in `./scorePreview`; this adds the debounce and the query.
 */
export function useScorePreview(
  gameId: string | null | undefined,
  text: string,
): ServerScorePreview {
  const { token } = useGamesRuntime();
  const available = codeParsingAvailable(useQueryClient());
  // What gets posted is the trimmed draft, so that is what gets previewed.
  const trimmed = text.trim();
  const [settledText, setSettledText] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettledText(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const offered = scorePreviewOffered({ available, token, gameId, text: trimmed });
  const query = useQuery(scorePreviewQueryOptions({ offered, token, gameId, settledText }));
  return serverScorePreviewState({
    offered,
    text: trimmed,
    settledText,
    isPending: query.isPending,
    data: query.data,
  });
}
