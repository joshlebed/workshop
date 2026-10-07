// The server's dry run of a pasted score, minus React: who gets it, how the
// request is made, and what the paste sheet should show at each moment. The
// hook (`useScorePreview`) only adds the debounce and the query subscription,
// so everything that decides behaviour lives here and is tested without a
// renderer (scorePreview.test.ts).

import type { QueryClient } from "@tanstack/react-query";
import type { GameScorePreview, GamesResponse } from "@workshop/shared/games";
import { previewGameScore } from "../api/games";
import { type ScorePreview, scorePreviewCaption } from "./scoreSpecs";

/**
 * Whether the server parses this account's scores with stored game code.
 * Read from the `GET /v1/games` responses already in the query cache, so an
 * account without the feature makes no extra request to find that out — and
 * never calls the preview endpoint (same idea as `useRecognitionAvailable`).
 */
export function codeParsingAvailable(queryClient: QueryClient): boolean {
  return queryClient
    .getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] })
    .some(([, data]) => data?.capabilities?.codeParsing === true);
}

/**
 * Whether the server will be asked about this draft at all. False means the
 * sheet previews locally, the way it always has.
 */
export function scorePreviewOffered(input: {
  available: boolean;
  token: string | null;
  gameId: string | null | undefined;
  /** The trimmed draft — what a post would send. */
  text: string;
}): boolean {
  return input.available && !!input.token && !!input.gameId && input.text.length > 0;
}

/** The preview request for one settled draft, as react-query options. */
export function scorePreviewQueryOptions(input: {
  offered: boolean;
  token: string | null;
  gameId: string | null | undefined;
  /** The trimmed draft once typing has settled. */
  settledText: string;
}) {
  const { gameId, settledText, token } = input;
  return {
    // Not under ["games"]: posting a score invalidates that prefix, and a
    // refetch of this would be a second, pointless preview call.
    queryKey: ["game-score-preview", gameId, settledText] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      previewGameScore(gameId ?? "", settledText, token, signal),
    enabled: input.offered && settledText.length > 0,
    staleTime: 5 * 60_000,
    // One attempt: a preview that failed is replaced by the local caption,
    // not waited for.
    retry: false,
  };
}

/**
 * The server's dry run of a draft, as the paste sheet needs to treat it:
 * - `unavailable`: not offered to this account, or the request failed —
 *   preview locally, the way the sheet always has.
 * - `pending`: the server will answer for this text but hasn't yet. Show
 *   nothing rather than the local parser's guess: for these accounts the
 *   server's reading is what gets stored, and the two can differ.
 * - `ready`: the answer for exactly the text on screen.
 */
export type ServerScorePreview =
  | { state: "unavailable" }
  | { state: "pending" }
  | { state: "ready"; preview: GameScorePreview };

const UNAVAILABLE: ServerScorePreview = { state: "unavailable" };
const PENDING: ServerScorePreview = { state: "pending" };

export function serverScorePreviewState(input: {
  offered: boolean;
  /** The trimmed draft on screen right now. */
  text: string;
  /** The draft the query was made for (lags `text` by the debounce). */
  settledText: string;
  isPending: boolean;
  data: GameScorePreview | null | undefined;
}): ServerScorePreview {
  if (!input.offered) return UNAVAILABLE;
  // Only an answer for the text on screen counts — not one for a previous draft.
  if (input.settledText !== input.text || input.isPending) return PENDING;
  // No data once settled = the request failed, or the body was not a preview.
  return input.data ? { state: "ready", preview: input.data } : UNAVAILABLE;
}

/**
 * The caption under the paste input. Nothing while the draft is empty, while
 * the teach chips are up (they say what will be recorded), or while the
 * server's answer is still out; the server's reading once it is in; the local
 * parser's when the server has nothing to say.
 */
export function pasteSheetCaption(input: {
  server: ServerScorePreview;
  local: ScorePreview | null;
  empty: boolean;
  showTeach: boolean;
}): string | null {
  if (input.empty || input.showTeach || input.server.state === "pending") return null;
  const server = input.server.state === "ready" ? input.server.preview : null;
  return scorePreviewCaption(server, input.local);
}
