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

import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { openExternalUrl } from "../../lib/openUrl";

/** Anything playable: a list `Item` or a Games-catalog `Game`. */
interface PlayTarget {
  id: string;
  url: string | null;
}

interface Pending {
  itemId: string;
  periodKey: string;
  /** Which surface armed the prompt — see `UseReturnToPasteArgs.scope`. */
  scope?: string;
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
      const p = parsed as Pending;
      return {
        itemId: p.itemId,
        periodKey: p.periodKey,
        ...(typeof p.scope === "string" ? { scope: p.scope } : {}),
      };
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
  /**
   * Which surface this instance serves ("list" by default, "games" for the
   * Games tab). A pending play armed on one surface must not pop the paste
   * sheet on the other — the ids live in different tables.
   */
  scope?: string;
}

export function useReturnToPaste({
  todayKey,
  hasScoreForItem,
  scope = "list",
}: UseReturnToPasteArgs) {
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
    // Another surface's pending play — leave it for that surface's instance.
    if ((pending.scope ?? "list") !== scope) return;
    // Stale (yesterday's) pending, or they already logged it elsewhere: drop it.
    if (pending.periodKey !== todayRef.current || hasScoreRef.current(pending.itemId)) {
      setPending(null);
      return;
    }
    setPromptItemId(pending.itemId);
  }, [scope]);

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

  const markPlaying = useCallback(
    (item: PlayTarget) => {
      setPending({ itemId: item.id, periodKey: todayRef.current, scope });
      openExternalUrl(item.url);
    },
    [scope],
  );

  const openPasteFor = useCallback((item: PlayTarget) => {
    setPromptItemId(item.id);
  }, []);

  const dismiss = useCallback(() => {
    setPending(null);
    setPromptItemId(null);
  }, []);

  return { promptItemId, markPlaying, openPasteFor, dismiss };
}
