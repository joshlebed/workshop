import { getItem } from "@workshop/api-client/storage";
import type { ListPreview } from "@workshop/shared";
import { useEffect, useState } from "react";
import { fetchInvitePreview } from "../api/invites";
import { fetchListPreview } from "../api/lists";
import { fetchListPreviewBySlug } from "../api/share";
import { PENDING_INVITE_TOKEN_KEY } from "../lib/inviteStash";
import { PENDING_RETURN_PATH_KEY, parseReturnPath } from "../lib/returnPath";
import { peekPendingShare, type SharePayload } from "../lib/sharePayload";

export type SignInContext =
  | { kind: "list"; preview: ListPreview; action: "join" | "see" }
  | { kind: "share"; payload: SharePayload }
  | null;

/**
 * Why the visitor is on the sign-in screen (4.1, 4.4): the list they came
 * from (a share link's stashed return path, or a legacy invite token) or a
 * share waiting to be saved. Read-only: AuthGate consumes the stashes after
 * sign-in. A preview that fails to load just leaves the plain sign-in.
 */
export function useSignInContext(): SignInContext {
  const [context, setContext] = useState<SignInContext>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const target = parseReturnPath(await getItem(PENDING_RETURN_PATH_KEY).catch(() => null));
      const inviteToken = await getItem(PENDING_INVITE_TOKEN_KEY).catch(() => null);
      let preview: ListPreview | null = null;
      let viaInvite = false;
      try {
        if (target?.kind === "slug") {
          preview = (await fetchListPreviewBySlug(target.slug, null)).preview;
        } else if (target?.kind === "list") {
          preview = (await fetchListPreview(target.id, null)).preview;
        } else if (target?.kind === "invite" || inviteToken) {
          const token = target?.kind === "invite" ? target.token : (inviteToken as string);
          preview = (await fetchInvitePreview(token)).preview;
          viaInvite = true;
        }
      } catch {
        preview = null;
      }
      if (cancelled) return;
      if (preview) {
        // A legacy invite token joins whatever the link's visibility says.
        const action = viaInvite || preview.shareVisibility === "join" ? "join" : "see";
        setContext({ kind: "list", preview, action });
        return;
      }
      const share = await peekPendingShare();
      if (!cancelled && share) setContext({ kind: "share", payload: share });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return context;
}
