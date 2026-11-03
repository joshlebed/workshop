// The one mutation every footer variant shares: POST the URL, haptic, hand the
// new game to the screen (toast + navigate home). Draft state lives here too so
// variants only differ in how the text gets into the box.

import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import type { Game } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useState } from "react";
import { useToast } from "../../../../theme";
import { addGame } from "../../../api/games";
import { useGamesRuntime } from "../../../runtime";

export interface AddByUrl {
  draft: string;
  setDraft: (next: string) => void;
  /** Trimmed draft is non-empty and nothing is in flight. */
  canSubmit: boolean;
  pending: boolean;
  /** Submit `url`, or the current draft when omitted. No-op when empty/pending. */
  submit: (url?: string) => void;
}

export function useAddByUrl(onAdded: (game: Game) => void | Promise<void>): AddByUrl {
  const { token } = useGamesRuntime();
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");

  const mutation = useMutation({
    mutationFn: (url: string) => addGame(url, token),
    onSuccess: async (data) => {
      haptics.medium();
      await onAdded(data.game);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
  });

  const trimmed = draft.trim();
  const submit = (url?: string) => {
    const target = (url ?? trimmed).trim();
    if (!target || mutation.isPending) return;
    mutation.mutate(target);
  };

  return {
    draft,
    setDraft,
    canSubmit: trimmed.length > 0 && !mutation.isPending,
    pending: mutation.isPending,
    submit,
  };
}
