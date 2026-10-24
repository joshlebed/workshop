import {
  HIGHSCORE_APP_SCHEME,
  HIGHSCORE_APP_STORE_URL,
  HIGHSCORE_WEB_URL,
} from "@workshop/shared/constants";
import { Linking } from "react-native";
import { type HandoffPlatform, type HighScoreTarget, highscorePath } from "./target";

export type { HandoffPlatform, HighScoreTarget };
export { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL };

/** Native build — the HighScore iOS app is the destination to push. */
export const HANDOFF_PLATFORM: HandoffPlatform = "ios";

/**
 * Open HighScore (native). Tries the custom scheme first — reliable whenever
 * the app is installed, unlike Universal Links (see `apps/workshop/CLAUDE.md`,
 * play links) — and falls back to the App Store listing when iOS rejects the
 * open (not installed). `canOpenURL` is deliberately not used: it needs
 * `LSApplicationQueriesSchemes`, a native Info.plist change that would force a
 * TestFlight build for an OTA-only cutover.
 */
export async function openHighScore(target: HighScoreTarget = {}): Promise<void> {
  const path = highscorePath(target);
  try {
    await Linking.openURL(`${HIGHSCORE_APP_SCHEME}://${path}`);
  } catch {
    openHighScoreAppStore();
  }
}

export function openHighScoreAppStore(): void {
  Linking.openURL(HIGHSCORE_APP_STORE_URL).catch(() => {
    /* best-effort */
  });
}

export function openHighScoreWeb(target: HighScoreTarget = {}): void {
  Linking.openURL(`${HIGHSCORE_WEB_URL}${highscorePath(target)}`).catch(() => {
    /* best-effort */
  });
}
