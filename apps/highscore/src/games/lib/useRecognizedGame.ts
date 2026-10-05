import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GamesResponse } from "@workshop/shared/games";
import { useEffect, useState } from "react";
import { type RecognizedGameMatch, recognizeGame } from "../api/recognition";
import { useGamesRuntime } from "../runtime";
import { isResultlessShare } from "./shareScoreDetection";

// Typing settles before we ask; a paste (the usual input) waits this once.
const DEBOUNCE_MS = 300;
// Nothing shorter is a result share, and it isn't worth a request to confirm.
const MIN_TEXT_LENGTH = 6;

/**
 * Whether the server has recognition on for this account. Read from the
 * `GET /v1/games` responses already in the query cache (every screen that
 * takes a score loads My Games first), so an account without the feature
 * makes no extra request to find that out — and never calls the endpoint.
 */
export function useRecognitionAvailable(): boolean {
  const queryClient = useQueryClient();
  return queryClient
    .getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] })
    .some(([, data]) => data?.capabilities?.recognition === true);
}

/**
 * The game the server recognizes `text` as a score for, or null — while it is
 * still asking, when it has no confident answer, when the request fails, and
 * always for accounts without the capability. Callers treat null as "use what
 * you would have done anyway"; nothing waits on this.
 */
export function useRecognizedGame(text: string): RecognizedGameMatch | null {
  const { token } = useGamesRuntime();
  const available = useRecognitionAvailable();
  const trimmed = text.trim();
  const [settled, setSettled] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const enabled =
    available && !!token && settled.length >= MIN_TEXT_LENGTH && !isResultlessShare(settled);
  const query = useQuery({
    // Not under ["games"]: posting a score invalidates that prefix, and a
    // refetch of this would be a second, pointless recognition call.
    queryKey: ["game-recognition", settled],
    queryFn: ({ signal }) => recognizeGame(settled, token, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Only an answer for the text on screen counts — not one for a previous draft.
  return enabled && settled === trimmed ? (query.data ?? null) : null;
}
