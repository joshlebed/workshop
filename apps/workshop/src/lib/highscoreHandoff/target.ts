/** Where the hand-off should push: the iOS app (native or iOS browser) or the web app. */
export type HandoffPlatform = "ios" | "ios-web" | "web";

export interface HighScoreTarget {
  /** Absolute HighScore path, e.g. `/g/<token>`. Defaults to the Games home. */
  path?: string;
}

/** Path inside HighScore for a hand-off target. */
export function highscorePath(target: HighScoreTarget): string {
  const path = target.path ?? "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/** iPhone / iPad (incl. iPadOS Safari, which reports as a Mac with touch). */
export function isIosUserAgent(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}
