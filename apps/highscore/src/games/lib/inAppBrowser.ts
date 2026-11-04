import { Platform } from "react-native";

// Third-party browsers can keep Universal Links inside their own WebView.
// Their support and user settings decide whether a link opens the native app.
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

/** HighScore ships on iOS; don't attempt its scheme on Android or desktop. */
export function canAutoOpenApp(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return isInAppBrowser(ua) && /iPhone|iPad|iPod/i.test(ua);
}
