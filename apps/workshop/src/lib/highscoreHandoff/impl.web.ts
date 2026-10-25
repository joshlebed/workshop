import { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL } from "@workshop/shared/constants";
import {
  type HandoffPlatform,
  type HighScoreTarget,
  highscorePath,
  isIosUserAgent,
} from "./target";

export type { HandoffPlatform, HighScoreTarget };
export { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL };

/**
 * Web build. On an iPhone/iPad browser the push is still the iOS app (App
 * Store); desktop and Android get highscore.live.
 */
export const HANDOFF_PLATFORM: HandoffPlatform =
  typeof navigator !== "undefined" &&
  isIosUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0)
    ? "ios-web"
    : "web";

/**
 * Open HighScore (web): navigate the current tab to highscore.live. The user is
 * leaving Workshop for good on this surface, so no new tab (popup blockers
 * swallow `window.open` outside a click handler anyway — the `/g/:token`
 * resolver calls this from an effect).
 */
export async function openHighScore(target: HighScoreTarget = {}): Promise<void> {
  window.location.assign(`${HIGHSCORE_WEB_URL}${highscorePath(target)}`);
}

export function openHighScoreAppStore(): void {
  window.location.assign(HIGHSCORE_APP_STORE_URL);
}

export function openHighScoreWeb(target: HighScoreTarget = {}): void {
  window.location.assign(`${HIGHSCORE_WEB_URL}${highscorePath(target)}`);
}
