import { Platform } from "react-native";

// Third-party in-app browsers (embedded WKWebViews) where iOS does NOT auto-open
// the native app from a Universal Link: the WebView's page *load* isn't a user
// tap, so the OS-level interception never fires (Apple's documented behavior).
// Only a real user tap on a Universal Link inside the WebView can route to the
// app — which is what the "Open in app" card on the play-link landing offers.
//
// These tokens cover the surfaces people actually share through (the Meta family
// is the live complaint). UA sniffing is heuristic, but reliable for these apps;
// it's also web-only — there's no in-app browser to detect on native.
//   FBAN / FBAV / FB_IAB / FBIOS — Facebook + Messenger (Messenger reuses the FB UA family)
//   Instagram — Instagram
const IN_APP_BROWSER_UA_RE = /(FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram)/i;

/**
 * True when the web app is running inside a detectable third-party in-app
 * browser (Facebook / Messenger / Instagram). Always false on native and when
 * there's no `navigator` (SSR / non-browser). Use only to *offer* an
 * open-in-app affordance — never to gate functionality, since UA strings drift.
 */
export function isInAppBrowser(userAgent?: string): boolean {
  if (Platform.OS !== "web") return false;
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return ua.length > 0 && IN_APP_BROWSER_UA_RE.test(ua);
}
