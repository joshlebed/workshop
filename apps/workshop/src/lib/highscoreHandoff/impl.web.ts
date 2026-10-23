import { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL } from "@workshop/shared/constants";
import { type HighScoreTarget, highscorePath } from "./target";

export type { HighScoreTarget };
export { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL };

/**
 * Hand the user off to HighScore (web). The user is leaving Workshop for good
 * on this surface, so navigate the current tab rather than popping a new one
 * (popup blockers swallow `window.open` outside a click handler anyway — the
 * `/g/:token` resolver calls this from an effect).
 */
export async function openHighScore(target: HighScoreTarget = {}): Promise<void> {
  window.location.assign(`${HIGHSCORE_WEB_URL}${highscorePath(target)}`);
}

export function openHighScoreAppStore(): void {
  window.open(HIGHSCORE_APP_STORE_URL, "_blank", "noopener");
}

export const HANDOFF_IS_NATIVE = false;
