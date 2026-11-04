import { describe, expect, it, vi } from "vitest";

// `isInAppBrowser` early-returns false off web, so mock Platform to web and pass
// the UA explicitly — keeps the test on the pure UA-matching surface (and off
// the native react-native import, which the node test collector can't follow).
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { canAutoOpenApp, isInAppBrowser } from "./inAppBrowser";

// Representative real-world UA shapes (trimmed).
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const MESSENGER_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/MessengerForiOS;FBAV/451.0.0;FBDV/iPhone15,2;FBMD/iPhone;FBLC/en_US]";
const FACEBOOK_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/468.0.0;FBBV/...;FBDV/iPhone15,2]";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 339.0.0.0.0 (iPhone15,2; iOS 17_5; en_US)";

describe("isInAppBrowser", () => {
  it("automatically opens only in supported iOS in-app browsers", () => {
    expect(canAutoOpenApp(MESSENGER_IOS)).toBe(true);
    expect(canAutoOpenApp(FACEBOOK_IOS)).toBe(true);
    expect(canAutoOpenApp(INSTAGRAM)).toBe(true);
    expect(canAutoOpenApp(SAFARI)).toBe(false);
    expect(canAutoOpenApp(CHROME_IOS)).toBe(false);
    expect(canAutoOpenApp("Mozilla/5.0 (Linux; Android 14) FB_IAB/FB4A")).toBe(false);
    expect(canAutoOpenApp("Mozilla/5.0 (Windows NT 10.0) Messenger")).toBe(false);
    expect(canAutoOpenApp("")).toBe(false);
  });

  it("flags the Meta in-app browsers users actually share through", () => {
    expect(isInAppBrowser(MESSENGER_IOS)).toBe(true);
    expect(isInAppBrowser(FACEBOOK_IOS)).toBe(true);
    expect(isInAppBrowser(INSTAGRAM)).toBe(true);
  });

  it("does not flag real Safari / Chrome", () => {
    expect(isInAppBrowser(SAFARI)).toBe(false);
    expect(isInAppBrowser(CHROME_IOS)).toBe(false);
  });

  it("is false for an empty / missing UA", () => {
    expect(isInAppBrowser("")).toBe(false);
  });
});
