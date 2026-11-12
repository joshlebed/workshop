import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AcceptInviteResponse, ListPreview } from "@workshop/shared";
import { useToast } from "@workshop/ui";
import { useCallback } from "react";
import { joinListBySlug } from "../api/share";
import { joinErrorMessage } from "../lib/errorCopy";

/**
 * Join action for `ListPublicLanding`, shared by `/l/:slug` and `/list/:id`
 * (UX pass 0.4, 0.5). Returns `null` when the viewer can't join from here
 * (signed out, or the link isn't in `join` visibility), which the landing
 * renders as the sign-in or "ask to join" state.
 *
 * A failed join shows a toast with the server's reason instead of silently
 * stopping the spinner.
 */
export function useJoinList({
  preview,
  token,
  onJoined,
}: {
  preview: ListPreview | undefined;
  token: string | null;
  onJoined: (res: AcceptInviteResponse) => void | Promise<void>;
}): (() => Promise<void>) | null {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const canJoin = !!preview && !!token && preview.shareVisibility === "join";
  const slug = preview?.shareSlug;

  const join = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await joinListBySlug(slug, token);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(res.list.id) }),
      ]);
      await onJoined(res);
    } catch (e) {
      showToast({ message: joinErrorMessage(e), tone: "danger" });
      // The landing may be stale (the owner changed sharing); refresh it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    }
  }, [slug, token, queryClient, onJoined, showToast]);

  return canJoin ? join : null;
}
