// Routes HighScore serves to everyone, signed in or not.
//
// `/support` and `/privacy` are the canonical URLs published to the App Store
// (support URL + privacy policy URL), so Apple's reviewers — and anyone who
// follows the link from a share — must land on real content instead of the
// sign-in screen. `AuthGate` in `app/_layout.tsx` consults `isPublicRoute`
// before every redirect, and also before the loading / "can't connect"
// interstitials, so a public page still renders when the API is unreachable.
//
// Keep the literals exactly `/support` and `/privacy`: they are registered in
// App Store Connect and can't drift without a metadata update.

export const SUPPORT_ROUTE = "/support";
export const PRIVACY_ROUTE = "/privacy";

export const PUBLIC_ROUTES = [SUPPORT_ROUTE, PRIVACY_ROUTE] as const;

const PUBLIC_ROUTE_SEGMENTS = new Set(PUBLIC_ROUTES.map((route) => route.replace(/^\//, "")));

/**
 * True when the router is on a route that needs no session. Accepts raw
 * `useSegments()` output — expo-router group segments (`(tabs)`) are stripped
 * so callers can pass either the raw or the already-filtered array.
 */
export function isPublicRoute(segments: readonly string[]): boolean {
  const first = segments.find((segment) => !segment.startsWith("("));
  return first !== undefined && PUBLIC_ROUTE_SEGMENTS.has(first);
}
