import { describe, expect, it } from "vitest";
import {
  APP_STORE_BANNER_COOKIE,
  appStoreBannerDismissCookie,
  isAppStoreBannerDismissed,
  shouldShowAppStoreBanner,
} from "./appStoreBanner";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_SAFARI = IPAD_SAFARI;
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const env = (userAgent: string, cookie = "", maxTouchPoints = 0) => ({
  userAgent,
  maxTouchPoints,
  cookie,
});

describe("shouldShowAppStoreBanner", () => {
  it("shows on iPhone Safari and Chrome with no cookie", () => {
    expect(shouldShowAppStoreBanner(env(IPHONE_SAFARI))).toBe(true);
    expect(shouldShowAppStoreBanner(env(IPHONE_CHROME))).toBe(true);
  });

  it("shows on iPadOS Safari (Mac UA with touch), not on a real Mac", () => {
    expect(shouldShowAppStoreBanner(env(IPAD_SAFARI, "", 5))).toBe(true);
    expect(shouldShowAppStoreBanner(env(MAC_SAFARI, "", 0))).toBe(false);
  });

  it("never shows on Android or desktop", () => {
    expect(shouldShowAppStoreBanner(env(ANDROID_CHROME))).toBe(false);
    expect(shouldShowAppStoreBanner(env(DESKTOP_CHROME))).toBe(false);
  });

  it("stays hidden once the dismissal cookie is set", () => {
    expect(shouldShowAppStoreBanner(env(IPHONE_SAFARI, `${APP_STORE_BANNER_COOKIE}=1`))).toBe(
      false,
    );
    expect(
      shouldShowAppStoreBanner(env(IPHONE_SAFARI, `other=2; ${APP_STORE_BANNER_COOKIE}=1; x=y`)),
    ).toBe(false);
  });

  it("ignores unrelated cookies that merely contain the name", () => {
    expect(isAppStoreBannerDismissed(`not_${APP_STORE_BANNER_COOKIE}=1`)).toBe(false);
    expect(isAppStoreBannerDismissed("")).toBe(false);
  });

  it("hides inside a standalone (home-screen / in-app) context", () => {
    expect(shouldShowAppStoreBanner({ ...env(IPHONE_SAFARI), standalone: true })).toBe(false);
  });
});

describe("appStoreBannerDismissCookie", () => {
  it("sets a long-lived, site-wide, Lax cookie", () => {
    const cookie = appStoreBannerDismissCookie(true);
    expect(cookie).toContain(`${APP_STORE_BANNER_COOKIE}=1`);
    expect(cookie).toContain("Max-Age=34560000");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(appStoreBannerDismissCookie(false)).not.toContain("Secure");
  });
});
