import { type Href, router } from "expo-router";

/**
 * Deterministic "breadcrumb-style" back button. On web, the user can land on
 * any deep route via a share link with no in-app history — `router.back()`
 * (which proxies to `window.history.back()`) silently does nothing in that
 * case. This helper navigates up to `fallbackHref` when there's nothing to
 * pop, so the back button always behaves like a breadcrumb up to the
 * logical parent in the route hierarchy.
 *
 * On native this behaves like `router.back()` for any pushed screen, and
 * falls back to `router.replace(fallbackHref)` if the stack only has the
 * deep-linked screen (the same problem in a different shape).
 *
 * `fallbackHref` is typed as a string here (not `Href`) because most callers
 * build it from a string template like `/list/${id}` and Href's typed-routes
 * union doesn't accept arbitrary string templates. The string is cast to
 * `Href` at the boundary so consumers stay ergonomic.
 */
export function goBack(fallbackHref: string) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref as Href);
}
