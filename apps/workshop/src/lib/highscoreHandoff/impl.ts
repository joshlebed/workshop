import {
  HIGHSCORE_APP_SCHEME,
  HIGHSCORE_APP_STORE_URL,
  HIGHSCORE_WEB_URL,
} from "@workshop/shared/constants";
import { Linking } from "react-native";
import { type HighScoreTarget, highscorePath } from "./target";

export type { HighScoreTarget };
export { HIGHSCORE_APP_STORE_URL, HIGHSCORE_WEB_URL };

/**
 * Hand the user off to HighScore (native). Tries the custom scheme first —
 * reliable whenever the app is installed, unlike Universal Links (see
 * `apps/workshop/CLAUDE.md`, play links) — and falls back to the App Store
 * listing when iOS rejects the open (not installed). `canOpenURL` is
 * deliberately not used: it needs `LSApplicationQueriesSchemes`, a native
 * Info.plist change that would force a TestFlight build for an OTA-only
 * cutover.
 */
export async function openHighScore(target: HighScoreTarget = {}): Promise<void> {
  const path = highscorePath(target);
  try {
    await Linking.openURL(`${HIGHSCORE_APP_SCHEME}://${path}`);
  } catch {
    await Linking.openURL(HIGHSCORE_APP_STORE_URL).catch(() => {
      /* best-effort */
    });
  }
}

export function openHighScoreAppStore(): void {
  Linking.openURL(HIGHSCORE_APP_STORE_URL).catch(() => {
    /* best-effort */
  });
}

export const HANDOFF_IS_NATIVE = true;
