// Score before sign-in (onboarding spike 1) — the two halves of the draft's
// life on an invite landing:
//   - `usePreloginDraftEditor`: signed out. The paste box, the local reading,
//     the stash, and the hand-off to sign-in with the invite context.
//   - `usePreloginDraftPost`: signed in, back on the same link. Posts the
//     stashed draft with the normal authenticated upsert and opens the board.
// Rules are in `lib/preloginDraft.ts`; storage in `lib/preloginDraftStore.ts`.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { setItem } from "@workshop/api-client/storage";
import { haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  type PreloginScoreTelemetry,
  reportPreloginScore,
  reportPreloginScoreOnUnload,
} from "../../api/telemetry";
import { useToast } from "../../theme";
import { addGame, upsertGameScore } from "../api/games";
import { PENDING_FRIEND_INVITE_TOKEN_KEY, PENDING_GAME_SHARE_TOKEN_KEY } from "../lib/inviteStash";
import { writePostedScore } from "../lib/postedScore";
import {
  buildDraft,
  draftDisposition,
  type InviteLinkKind,
  newDraftId,
  type PreloginScoreDraft,
  readDraftText,
} from "../lib/preloginDraft";
import {
  clearInviteContext,
  clearPreloginDraft,
  loadPreloginDraft,
  saveInviteContext,
  savePreloginDraft,
} from "../lib/preloginDraftStore";
import { useGamesRuntime } from "../runtime";
import { useToday } from "../state/viewDay";
import { usePostedScoreNotice } from "./usePostedScoreNotice";

function draftTelemetry(
  draft: PreloginScoreDraft,
  event: PreloginScoreTelemetry["event"],
  extra: Partial<PreloginScoreTelemetry> = {},
): PreloginScoreTelemetry {
  return {
    event,
    draftId: draft.id,
    linkKind: draft.linkKind,
    gameKey: draft.gameKey,
    ...(draft.sharerPlayed === undefined ? {} : { sharerPlayed: draft.sharerPlayed }),
    ageMs: Math.max(0, Date.now() - draft.createdAt),
    ...extra,
  };
}

/** Drop a stashed draft from another day, reporting it as abandoned. */
async function expireIfStale(
  draft: PreloginScoreDraft | null,
  disposition: ReturnType<typeof draftDisposition>,
  token: string | null,
): Promise<void> {
  if (!draft || disposition !== "expired") return;
  await clearPreloginDraft();
  void reportPreloginScore(draftTelemetry(draft, "draft_abandoned", { reason: "expired" }), token);
}

export interface InviteLandingInviter {
  userId: string;
  displayName: string | null;
}

/**
 * Signed-out landing: the paste box's text, what it reads as, and
 * `goToSignIn`. A recognised paste is stashed as it is typed, so a visitor
 * who leaves for sign-in by any route (the button, the address bar) keeps it.
 */
export function usePreloginDraftEditor({
  linkKind,
  linkToken,
  inviter,
  sharerGames,
}: {
  linkKind: InviteLinkKind;
  linkToken: string;
  /** Null while the link is still resolving. */
  inviter: InviteLandingInviter | null;
  sharerGames: readonly string[];
}) {
  const router = useRouter();
  const today = useToday();
  const { routes } = useGamesRuntime();
  const [text, setText] = useState("");
  const [restored, setRestored] = useState(false);
  const draftIdRef = useRef(newDraftId());
  // The draft currently in storage from this landing (null = none saved yet).
  const savedRef = useRef<PreloginScoreDraft | null>(null);
  // A draft for another link that ours would overwrite.
  const otherDraftRef = useRef<PreloginScoreDraft | null>(null);
  const reportedCreatedRef = useRef<string | null>(null);

  const reading = useMemo(() => readDraftText(text), [text]);
  const sharerGamesKey = sharerGames.join("\u0000");

  // Restore this link's draft (a visitor back from sign-in without signing
  // in), expire another day's, and remember another link's.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadPreloginDraft();
      if (cancelled) return;
      const disposition = draftDisposition(stored, linkKind, linkToken, today);
      await expireIfStale(stored, disposition, null);
      if (stored && disposition === "use") {
        draftIdRef.current = stored.id;
        savedRef.current = stored;
        reportedCreatedRef.current = stored.id;
        setText(stored.scoreRaw);
      } else if (stored && disposition === "other-link") {
        otherDraftRef.current = stored;
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [linkKind, linkToken, today]);

  // Funnel denominator: one view per landing, once the inviter is known.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!inviter || viewedRef.current) return;
    viewedRef.current = true;
    void reportPreloginScore({ event: "landing_viewed", linkKind }, null);
  }, [inviter, linkKind]);

  // Keep storage in step with the paste box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sharerGamesKey stands in for sharerGames
  useEffect(() => {
    if (!restored) return;
    const draft = buildDraft({
      id: draftIdRef.current,
      text,
      reading,
      linkKind,
      linkToken,
      periodKey: today,
      now: savedRef.current?.createdAt ?? Date.now(),
      sharerGames,
    });
    if (draft) {
      const other = otherDraftRef.current;
      if (other) {
        otherDraftRef.current = null;
        void reportPreloginScore(
          draftTelemetry(other, "draft_abandoned", { reason: "replaced" }),
          null,
        );
      }
      savedRef.current = draft;
      void savePreloginDraft(draft);
      if (reportedCreatedRef.current !== draft.id) {
        reportedCreatedRef.current = draft.id;
        void reportPreloginScore(draftTelemetry(draft, "draft_created"), null);
      }
      return;
    }
    const saved = savedRef.current;
    if (saved) {
      // The visitor cleared or rewrote a recognised paste.
      savedRef.current = null;
      void clearPreloginDraft();
      void reportPreloginScore(
        draftTelemetry(saved, "draft_abandoned", { reason: "discarded" }),
        null,
      );
      // A new recognised paste is a new draft.
      draftIdRef.current = newDraftId();
    }
  }, [restored, text, reading, linkKind, linkToken, today, sharerGamesKey]);

  // Web: a visitor who closes the tab with a draft and never signed in.
  // (A later post with the same draft id supersedes this line.)
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onPageHide = () => {
      const saved = savedRef.current;
      if (!saved) return;
      reportPreloginScoreOnUnload(
        draftTelemetry(saved, "draft_abandoned", { reason: "left_page" }),
      );
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const goToSignIn = useCallback(async () => {
    if (inviter) {
      await saveInviteContext({
        v: 1,
        linkKind,
        linkToken,
        inviterName: inviter.displayName,
        inviterId: inviter.userId,
        savedAt: Date.now(),
      });
    }
    // The landing stashes the token on mount too; set it again so the context
    // above is never orphaned by a race with that write.
    await setItem(
      linkKind === "play" ? PENDING_GAME_SHARE_TOKEN_KEY : PENDING_FRIEND_INVITE_TOKEN_KEY,
      linkToken,
    ).catch(() => {});
    const saved = savedRef.current;
    void reportPreloginScore(
      saved ? draftTelemetry(saved, "signin_opened") : { event: "signin_opened", linkKind },
      null,
    );
    router.replace(routes.signIn as Href);
  }, [inviter, linkKind, linkToken, router, routes.signIn]);

  const clear = useCallback(() => setText(""), []);

  return { text, setText, reading, clear, goToSignIn, restored };
}

/**
 * Signed in, back on the link: the stashed draft for it (if any) and `post`,
 * which find-or-creates the game, upserts the score, writes it into the home
 * cache and replaces the route with that game's board for the draft's day —
 * where the new friend's score sits next to the visitor's. A failed post
 * says so, drops the draft (so the landing can't loop on it) and hands back
 * to `onFailed`.
 */
export function usePreloginDraftPost({
  linkKind,
  linkToken,
  enabled,
}: {
  linkKind: InviteLinkKind;
  linkToken: string | null;
  enabled: boolean;
}) {
  const { token, user, routes } = useGamesRuntime();
  const today = useToday();
  const router = useRouter();
  const queryClient = useQueryClient();
  const notifyPosted = usePostedScoreNotice();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<PreloginScoreDraft | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !linkToken) return;
    let cancelled = false;
    void (async () => {
      const stored = await loadPreloginDraft();
      if (cancelled) return;
      const disposition = draftDisposition(stored, linkKind, linkToken, today);
      await expireIfStale(stored, disposition, token);
      setDraft(disposition === "use" ? stored : null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, linkKind, linkToken, today, token]);

  const mutation = useMutation({
    mutationFn: async (d: PreloginScoreDraft) => {
      const gameId = (await addGame(d.canonicalUrl, token)).game.id;
      const result = await upsertGameScore(
        gameId,
        { periodKey: d.periodKey, scoreRaw: d.scoreRaw, entrySource: "paste" },
        token,
      );
      return { gameId, result };
    },
    onSuccess: async ({ gameId, result }, d) => {
      haptics.medium();
      await Promise.all([clearPreloginDraft(), clearInviteContext()]);
      void reportPreloginScore(draftTelemetry(d, "draft_posted"), token);
      writePostedScore(queryClient, result, user);
      notifyPosted({
        result,
        gameId,
        periodKey: d.periodKey,
        scoreRaw: d.scoreRaw,
        today,
        posted: `${d.gameTitle} score saved`,
      });
      setDraft(null);
      router.replace(routes.game(gameId, d.periodKey) as Href);
      void queryClient.invalidateQueries({ queryKey: ["games"] });
    },
    onError: async (e, d) => {
      await clearPreloginDraft();
      void reportPreloginScore(
        draftTelemetry(d, "draft_abandoned", { reason: "post_failed" }),
        token,
      );
      setDraft(null);
      showToast({
        message: errorMessage(e, `Couldn't save your ${d.gameTitle} score`),
        tone: "danger",
      });
    },
  });

  const post = useCallback(
    (onFailed?: () => void) => {
      if (!draft) return;
      mutation.mutate(draft, { onError: () => onFailed?.() });
    },
    [draft, mutation],
  );

  // `posted`: the board is opening. The landing must render nothing that
  // navigates from here on — the accept invalidated its preview, and a refetch
  // that now says "already friends" would otherwise redirect over the board.
  return { draft, loaded, post, posting: mutation.isPending, posted: mutation.isSuccess };
}
