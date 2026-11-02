import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useGamesRuntime } from "../runtime";
import {
  type FormatterCardView,
  formatterCardView,
  formatterPreviewAvailable,
  formatterPreviewOffered,
  formatterPreviewQueryOptions,
  formatterSuggestAvailable,
  formatterSuggestQueryOptions,
} from "./formatterPreview";

const DEBOUNCE_MS = 400;

/**
 * PROTOTYPE — the "Summary preview" card's data for one draft. Decisions live
 * in `./formatterPreview`; this adds the debounce and the two queries.
 */
export function useFormatterPreview(input: {
  gameId: string | null | undefined;
  hasFormatter: boolean | undefined;
  text: string;
}): FormatterCardView & { settledText: string } {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const available = formatterPreviewAvailable(queryClient);
  const suggest = formatterSuggestAvailable(queryClient);
  const trimmed = input.text.trim();
  const [settledText, setSettledText] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettledText(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const offered = formatterPreviewOffered({
    available,
    token,
    gameId: input.gameId,
    hasFormatter: input.hasFormatter,
    text: settledText,
  });
  const preview = useQuery(
    formatterPreviewQueryOptions({ offered, token, gameId: input.gameId, settledText }),
  );
  const suggestion = useQuery(
    formatterSuggestQueryOptions({ offered, suggest, token, gameId: input.gameId, settledText }),
  );
  const view = formatterCardView({
    offered: offered || (available && input.hasFormatter === false && trimmed.length > 0),
    stale: settledText !== trimmed,
    preview: { isPending: preview.isPending, data: preview.data },
    suggest: {
      enabled: offered && suggest,
      isPending: suggestion.isPending,
      data: suggestion.data,
    },
  });
  return { ...view, settledText };
}
