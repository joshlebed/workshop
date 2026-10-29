// "Get the app" banner shown at the top of HighScore web on iPhone / iPad
// browsers. Pure decision + cookie helpers so the rule is testable without
// a DOM; `components/AppStoreBanner.web.tsx` wires them to the page.
//
// Dismissal is a per-device cookie (not server state on purpose): the user
// asked for the X to be permanent on this device and for a new device to see
// the banner again. Browsers cap cookie lifetime at 400 days (Chrome 104+),
// so "permanent" is "as long as the platform allows", refreshed never.

export const APP_STORE_BANNER_COOKIE = "hs_app_banner_dismissed";

/** 400 days — the longest `Max-Age` modern browsers honor. */
export const APP_STORE_BANNER_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** iPhone / iPad (incl. iPadOS Safari, which reports as a Mac with touch). */
export function isIosUserAgent(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

/** True when `document.cookie` carries the dismissal marker. */
export function isAppStoreBannerDismissed(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .some((part) => part.trim().split("=")[0] === APP_STORE_BANNER_COOKIE);
}

export interface AppStoreBannerEnv {
  userAgent: string;
  maxTouchPoints: number;
  cookie: string;
  /** `true` inside the iOS app's own web views, where the banner is pointless. */
  standalone?: boolean;
}

/**
 * Show on an iOS browser that hasn't dismissed it. Android and desktop never
 * see it: the App Store link is a dead end there, and the sign-in screen's
 * App Store card already covers the "I'm on a laptop, what's the app?" case.
 */
export function shouldShowAppStoreBanner(env: AppStoreBannerEnv): boolean {
  if (env.standalone) return false;
  if (!isIosUserAgent(env.userAgent, env.maxTouchPoints)) return false;
  return !isAppStoreBannerDismissed(env.cookie);
}

/** The `Set-Cookie`-shaped string to assign to `document.cookie` on dismiss. */
export function appStoreBannerDismissCookie(secure: boolean): string {
  const attrs = [
    `${APP_STORE_BANNER_COOKIE}=1`,
    `Max-Age=${APP_STORE_BANNER_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
