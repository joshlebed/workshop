// URL ↔ shell state. HighScore's main loop pushes no visible screens: the
// ledger, the expanded board, and the friends drawer are one surface. The URL
// still has to be honest, so `/`, `/games/:id`, `/friends` and
// `/friends/:userId` are real routes under `app/(shell)/` whose components
// render `null` — the persistent `(shell)` layout reads the pathname through
// this hook and animates itself into the matching state.
//
// Everything the shell needs to know is derived from `usePathname()`.
// `useSegments()` is useless here: it returns the *pattern* (`["games","[id]"]`),
// not the values.

import { type Href, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useCallback, useRef } from "react";

export type DrawerPanel = null | { kind: "friends" } | { kind: "friend"; userId: string };

export interface ShellNavigation {
  /** Game expanded in the ledger — mirrors `/games/:id`. */
  expandedGameId: string | null;
  /** Which drawer panel is showing — mirrors `/friends` and `/friends/:userId`. */
  drawer: DrawerPanel;
  /** Play-link vouch token (`?via=`) forwarded to a not-yet-friend's profile. */
  via: string | undefined;
  expandGame: (gameId: string) => void;
  collapseGame: () => void;
  openFriends: () => void;
  openFriend: (userId: string, via?: string) => void;
  /** Dismiss the whole drawer, restoring whatever the ledger was showing. */
  closeDrawer: () => void;
  /** One panel back inside the drawer (friend profile → friends list). */
  drawerBack: () => void;
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function gameHref(gameId: string): string {
  return `/games/${encodeURIComponent(gameId)}`;
}

export function friendHref(userId: string, via?: string): string {
  const base = `/friends/${encodeURIComponent(userId)}`;
  return via ? `${base}?via=${encodeURIComponent(via)}` : base;
}

export function useShellNavigation(): ShellNavigation {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ via?: string | string[] }>();
  const rawVia = params.via;
  const via = Array.isArray(rawVia) ? rawVia[0] : rawVia;

  const segments = pathSegments(pathname);
  const [first, second] = segments;

  const routeGameId = first === "games" && second ? second : null;
  // `/friends/accept/:token` is a full-page route that lives outside the
  // shell; it has three segments, so it can never be read as a profile.
  const drawer: DrawerPanel =
    first === "friends" && segments.length === 1
      ? { kind: "friends" }
      : first === "friends" && segments.length === 2 && second && second !== "accept"
        ? { kind: "friend", userId: second }
        : null;

  // While the drawer covers the ledger the URL is a `/friends` one, so the
  // expanded game can't be read off it. Remember the ledger's href (and its
  // expanded game) so the board stays open behind the backdrop and closing the
  // drawer lands exactly back on it.
  const ledgerHrefRef = useRef<string>("/");
  const ledgerGameRef = useRef<string | null>(null);
  if (drawer === null) {
    ledgerHrefRef.current = routeGameId ? gameHref(routeGameId) : "/";
    ledgerGameRef.current = routeGameId;
  }

  const expandGame = useCallback(
    (gameId: string) => {
      // Swapping between games while expanded replaces rather than pushes, so
      // one back press always returns to the closed ledger.
      const href = gameHref(gameId) as Href;
      if (ledgerGameRef.current) router.replace(href);
      else router.push(href);
    },
    [router],
  );

  const collapseGame = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const openFriends = useCallback(() => {
    router.push("/friends");
  }, [router]);

  const openFriend = useCallback(
    (userId: string, viaToken?: string) => {
      router.push(friendHref(userId, viaToken) as Href);
    },
    [router],
  );

  const closeDrawer = useCallback(() => {
    router.dismissTo(ledgerHrefRef.current as Href);
  }, [router]);

  const drawerBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/friends");
  }, [router]);

  return {
    expandedGameId: drawer === null ? routeGameId : ledgerGameRef.current,
    drawer,
    via,
    expandGame,
    collapseGame,
    openFriends,
    openFriend,
    closeDrawer,
    drawerBack,
  };
}
