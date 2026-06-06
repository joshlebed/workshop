// "Play, then paste when you come back" — the leaderboard card's play loop.
//
// Tapping Play opens the game in a new tab (web) / backgrounds the app
// (native) and remembers which game today. When the app/page returns to the
// foreground, if the viewer still has no score for that game, we surface the
// paste sheet so logging the result is one paste away.
//
// `AppState` covers both platforms: react-native-web maps it onto the Page
// Visibility API, so returning to the tab fires `change → "active"` just like
// foregrounding the native app does. Pending state lives in module memory
// (survives backgrounding, since the JS context stays alive) and is mirrored
// to `sessionStorage` on web as cheap insurance against a same-tab reload.

import type { Item } from "@workshop/shared";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { openExternalUrl } from "../../lib/openUrl";

interface Pending {
  itemId: string;
  periodKey: string;
}

const SESSION_KEY = "workshop:pendingPlay";
let memoryPending: Pending | null = null;

function readSession(): Pending | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Pending).itemId === "string" &&
      typeof (parsed as Pending).periodKey === "string"
    ) {
      return { itemId: (parsed as Pending).itemId, periodKey: (parsed as Pending).periodKey };
    }
  } catch {
    /* storage disabled / quota — fall back to memory */
  }
  return null;
}

function writeSession(pending: Pending | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (pending) sessionStorage.setItem(SESSION_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* best-effort */
  }
}

function getPending(): Pending | null {
  return memoryPending ?? readSession();
}

function setPending(pending: Pending | null): void {
  memoryPending = pending;
  writeSession(pending);
}

interface UseReturnToPasteArgs {
  todayKey: string;
  /** Latest "has the viewer logged a score for this game today" predicate. */
  hasScoreForItem: (itemId: string) => boolean;
}

export function useReturnToPaste({ todayKey, hasScoreForItem }: UseReturnToPasteArgs) {
  const [promptItemId, setPromptItemId] = useState<string | null>(null);
  // Read the freshest predicate/day inside the AppState listener without
  // re-subscribing on every scores refetch.
  const hasScoreRef = useRef(hasScoreForItem);
  hasScoreRef.current = hasScoreForItem;
  const todayRef = useRef(todayKey);
  todayRef.current = todayKey;

  const checkPending = useCallback(() => {
    const pending = getPending();
    if (!pending) return;
    // Stale (yesterday's) pending, or they already logged it elsewhere: drop it.
    if (pending.periodKey !== todayRef.current || hasScoreRef.current(pending.itemId)) {
      setPending(null);
      return;
    }
    setPromptItemId(pending.itemId);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkPending();
    });
    return () => sub.remove();
  }, [checkPending]);

  // The share-sheet pathway supersedes the play-then-paste prompt. Sharing a
  // game result foregrounds the app — which arms this prompt via the AppState
  // listener above — *and* routes to `/share` to post the score (the richer
  // path: it carries the actual result text). Without this, the paste sheet
  // stacks on top of the share screen. Drop the pending play and dismiss the
  // prompt whenever the share screen is active so it yields to the share flow.
  const pathname = usePathname();
  useEffect(() => {
    if (pathname?.startsWith("/share")) {
      setPending(null);
      setPromptItemId(null);
    }
  }, [pathname]);

  const markPlaying = useCallback((item: Item) => {
    setPending({ itemId: item.id, periodKey: todayRef.current });
    openExternalUrl(item.url);
  }, []);

  const openPasteFor = useCallback((item: Item) => {
    setPromptItemId(item.id);
  }, []);

  const dismiss = useCallback(() => {
    setPending(null);
    setPromptItemId(null);
  }, []);

  return { promptItemId, markPlaying, openPasteFor, dismiss };
}
