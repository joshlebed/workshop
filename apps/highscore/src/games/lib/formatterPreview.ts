// PROTOTYPE — the paste sheet's "Summary preview" card, minus React: who gets
// it, the two requests as react-query options, and what the card shows. The
// hook (`useFormatterPreview`) only adds the debounce and the subscriptions.

import type { QueryClient } from "@tanstack/react-query";
import type { GamesResponse } from "@workshop/shared/games";
import {
  type FormatterPreview,
  type FormatterSuggestion,
  previewFormatter,
  suggestFormatter,
} from "../api/formatter";

function capabilities(queryClient: QueryClient) {
  return queryClient
    .getQueriesData<GamesResponse>({ queryKey: ["games", "mine"] })
    .map(([, data]) => data?.capabilities);
}

/** `capabilities.formatterPreview`, read from the cached `GET /v1/games` (no probe). */
export function formatterPreviewAvailable(queryClient: QueryClient): boolean {
  return capabilities(queryClient).some((c) => c?.formatterPreview === true);
}

/** `capabilities.formatterSuggest`: the card may also ask the model. */
export function formatterSuggestAvailable(queryClient: QueryClient): boolean {
  return capabilities(queryClient).some((c) => c?.formatterSuggest === true);
}

/** Whether the card is offered for this draft at all. */
export function formatterPreviewOffered(input: {
  available: boolean;
  token: string | null;
  gameId: string | null | undefined;
  /** `Game.hasFormatter`; only `false` (known to have none) offers the card. */
  hasFormatter: boolean | undefined;
  /** The trimmed, settled draft. */
  text: string;
}): boolean {
  return (
    input.available &&
    !!input.token &&
    !!input.gameId &&
    input.hasFormatter === false &&
    input.text.length > 0
  );
}

export function formatterPreviewQueryOptions(input: {
  offered: boolean;
  token: string | null;
  gameId: string | null | undefined;
  settledText: string;
}) {
  const { gameId, settledText, token } = input;
  return {
    // Not under ["games"]: posting invalidates that prefix.
    queryKey: ["formatter-preview", gameId, settledText] as const,
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<FormatterPreview | null> =>
      previewFormatter(gameId ?? "", settledText, token, signal),
    enabled: input.offered && settledText.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  };
}

export function formatterSuggestQueryOptions(input: {
  offered: boolean;
  suggest: boolean;
  token: string | null;
  gameId: string | null | undefined;
  settledText: string;
}) {
  const { gameId, settledText, token } = input;
  return {
    queryKey: ["formatter-suggest", gameId, settledText] as const,
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<FormatterSuggestion | null> =>
      suggestFormatter(gameId ?? "", settledText, token, signal),
    // One model call per distinct paste: never refetched.
    enabled: input.offered && input.suggest && settledText.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    retry: false,
  };
}

export type FormatterCandidateKind = "heuristic" | "llm";

/** One rendered option on the card. */
export interface FormatterOption {
  kind: FormatterCandidateKind;
  label: string;
  /** Per sample, in sample order; null renders as "(full text)". */
  summaries: (string | null)[];
  /** Only for `llm`: what "Looks good" sends back. */
  code?: string;
  token?: string;
}

/**
 * What the card shows. `hidden`: nothing to offer (not offered, the game has a
 * formatter, or neither option renders the paste to anything). `loading`: the
 * heuristic preview is still out.
 */
export type FormatterCardView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | {
      kind: "ready";
      samples: FormatterPreview["samples"];
      options: FormatterOption[];
      /** The model's option is still being written. */
      suggesting: boolean;
    };

export function formatterCardView(input: {
  offered: boolean;
  /** The draft on screen differs from the one the queries ran for. */
  stale: boolean;
  preview: { isPending: boolean; data: FormatterPreview | null | undefined };
  suggest: {
    enabled: boolean;
    isPending: boolean;
    data: FormatterSuggestion | null | undefined;
  };
}): FormatterCardView {
  if (!input.offered) return { kind: "hidden" };
  if (input.stale || input.preview.isPending) return { kind: "loading" };
  const preview = input.preview.data;
  if (!preview || preview.hasFormatter) return { kind: "hidden" };
  const options: FormatterOption[] = [];
  if (preview.heuristic?.summaries[0]) {
    options.push({ kind: "heuristic", label: "Simple", summaries: preview.heuristic.summaries });
  }
  const llm = input.suggest.data?.candidate;
  if (llm?.summaries[0]) {
    options.push({
      kind: "llm",
      label: "AI-written",
      summaries: llm.summaries,
      code: llm.code,
      token: llm.token,
    });
  }
  const suggesting = input.suggest.enabled && input.suggest.isPending;
  if (options.length === 0 && !suggesting) return { kind: "hidden" };
  return { kind: "ready", samples: preview.samples, options, suggesting };
}
