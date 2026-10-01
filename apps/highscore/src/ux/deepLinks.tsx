// Route components that are playground-only.
//
// Two kinds live here:
//
// 1. **ux1's deep-link resolvers.** On its own branch they were the bodies of
//    `app/games/[id].tsx`, `app/friends/index.tsx` and `app/friends/[userId].tsx`.
//    The deck is one screen, so those URLs hand their target to `DeckNav` and
//    step aside. In the playground every route file is a dispatcher, so the
//    bodies moved here unchanged.
// 2. **Fallbacks for routes a variant never defined.** ux1, ux2 and ux3 have no
//    `/you`; the playground still has to resolve it. The mapping is documented
//    in `apps/highscore/UX-PLAYGROUND.md`.

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useDeckNav } from "../variants/ux1/deck/DeckNav";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** ux1 `/games/:id` — resolves into the deck, then replaces itself with `/`. */
export function Ux1GameDeepLink() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = first(params.id);
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    if (id) nav.openGame(id);
    router.replace("/");
  }, [id, nav, router]);
  return null;
}

/** ux1 `/friends` — friends are a panel on the one screen, not a route. */
export function Ux1FriendsDeepLink() {
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    nav.setPanel("players");
    router.replace("/");
  }, [nav, router]);
  return null;
}

/** ux1 `/friends/:userId` — one player inside the PLAYERS panel. */
export function Ux1FriendProfileDeepLink() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = first(params.userId);
  const via = first(params.via);
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    if (userId) nav.openPlayer(userId, via ?? null);
    router.replace("/");
  }, [userId, via, nav, router]);
  return null;
}

/**
 * ux1 `/you` — ux1 has no `/you` route; YOU is the third key of the deck's
 * control panel. Resolve it the same way the other deep links resolve.
 */
export function Ux1YouDeepLink() {
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    nav.setPanel("you");
    router.replace("/");
  }, [nav, router]);
  return null;
}

/**
 * ux2 / ux3 `/you` — neither defines the route. ux2's "you" is a bottom sheet
 * raised from the shell and its account *screen* is `/profile`; ux3's account
 * surface is the `/profile` sheet. Both map to `/profile`.
 */
export function RedirectToProfile() {
  return <Redirect href="/profile" />;
}

/** A route a variant renders nothing for — its persistent layout draws the URL. */
export function RenderedByLayout() {
  return null;
}
