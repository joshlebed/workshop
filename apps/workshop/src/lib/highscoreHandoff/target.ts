export interface HighScoreTarget {
  /** Absolute HighScore path, e.g. `/g/<token>`. Defaults to the Games home. */
  path?: string;
  /** A shared score payload to pre-fill HighScore's `/share` picker with. */
  share?: { url?: string | null; text?: string | null };
}

/**
 * Path (+ query) inside HighScore for a hand-off target. HighScore's
 * `/share` → `PickGame` reads the same `url` / `text` params Workshop's own
 * share flow uses, so a score that landed in Workshop's share extension can
 * be posted in HighScore in one tap.
 */
export function highscorePath(target: HighScoreTarget): string {
  if (target.share) {
    const params = new URLSearchParams();
    const url = target.share.url?.trim();
    const text = target.share.text?.trim();
    if (url) params.set("url", url);
    if (text) params.set("text", text);
    const qs = params.toString();
    return qs ? `/share?${qs}` : "/share";
  }
  const path = target.path ?? "/";
  return path.startsWith("/") ? path : `/${path}`;
}
