import { type Href, router } from "expo-router";

/**
 * Workshop's back button (UX pass 3.8). Pops when what sits beneath the
 * current screen is real history, and otherwise goes to the screen's logical
 * parent (`parentHref`).
 *
 * "Not real history" is the cold-open case: `(lists)/_layout.tsx` anchors its
 * stack on home, so a route reached by a deep link, a reload or a
 * cross-navigator `replace` has home injected beneath it. For a screen whose
 * parent is home that is the right place to land. For a screen whose parent
 * is a list (add, add-bulk, settings, item detail) a plain `router.back()`
 * dropped the person on home, and because the anchor inherits the deep link's
 * params the URL read `/?id=<listId>`. In that case we `dismissTo` the parent
 * instead: the current screen is replaced by the list, leaving home beneath it
 * so the next back still works.
 *
 * HighScore keeps `@workshop/ui/navigation`'s simpler helper.
 */

import { focusedStack, type NavState, resolveBack } from "./backResolver";

export type { NavState } from "./backResolver";

type StateGetter = () => NavState | undefined;

let getRootState: StateGetter | null = null;

/** Called once by the root layout with the navigation container's state getter. */
export function registerNavigationState(getter: StateGetter): void {
  getRootState = getter;
}

export function goBack(parentHref: string): void {
  const action = resolveBack(focusedStack(getRootState?.()), parentHref, router.canGoBack());
  if (action === "back") router.back();
  else if (action === "dismissToParent") router.dismissTo(parentHref as Href);
  else router.replace(parentHref as Href);
}

/**
 * Land on a list that was just made (create, duplicate) with home directly
 * beneath it, so back and swipe-back go home rather than through the flow
 * that made it (3.8). Only for routes inside the `(lists)` stack; root-stack
 * flows (join, accept, share) use `router.replace(…, { withAnchor: true })`.
 */
export function openListOverHome(listId: string): void {
  router.dismissTo("/");
  router.push(`/list/${listId}` as Href);
}
