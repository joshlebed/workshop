import { apiErrorCode, errorMessage } from "./apiError";

/**
 * Two contexts where source errors surface, with subtly different copy.
 *
 *   "settings" — list already exists; "Update the source URL in settings" is
 *     valid actionable advice.
 *   "creation" — list doesn't exist yet; the user is pasting a URL into the
 *     create-list flow, so settings-deep-link copy doesn't apply.
 *
 * Both contexts share the same backend error codes; only the user-facing copy
 * varies. Keeping the mapping in one place means a new code only has to be
 * handled once.
 */
export type SourceErrorContext = "settings" | "creation";

const COPY: Record<string, Record<SourceErrorContext, string>> = {
  // --- Spotify playlist ---
  INVALID_PLAYLIST_URL: {
    settings: "That doesn't look like a Spotify playlist URL.",
    creation: "That doesn't look like a Spotify playlist URL.",
  },
  PLAYLIST_NOT_AVAILABLE: {
    settings: "Source playlist is private or deleted. Update the source URL in settings.",
    creation: "That playlist isn't public. Make it public on Spotify and try again.",
  },
  SPOTIFY_UNAVAILABLE: {
    settings: "Spotify is having a moment. Try again.",
    creation: "Spotify is having a moment. Give it a beat.",
  },
  // --- Letterboxd list ---
  INVALID_LETTERBOXD_URL: {
    settings: "That doesn't look like a Letterboxd list URL.",
    creation: "That doesn't look like a Letterboxd list URL.",
  },
  LIST_NOT_FOUND: {
    settings: "Source list isn't reachable. Update the source URL in settings.",
    creation: "We couldn't find that Letterboxd list. Check the URL and try again.",
  },
  LIST_NOT_AVAILABLE: {
    settings: "Source list is private or deleted. Update the source URL in settings.",
    creation: "That list isn't public. Make it public on Letterboxd and try again.",
  },
  LIST_FETCH_FAILED: {
    settings: "Letterboxd is having a moment. Try again.",
    creation: "Letterboxd is having a moment. Give it a beat.",
  },
};

/**
 * Render a user-facing message for an error returned by a source (Spotify
 * playlist, Letterboxd list, …). The structured `details.code` set by the
 * backend dispatch routes carries the discriminator; we map each one to a
 * copy variant.
 */
export function sourceErrorMessage(
  err: unknown,
  fallback: string,
  context: SourceErrorContext = "settings",
): string {
  const code = apiErrorCode(err);
  if (code && COPY[code]) return COPY[code][context];
  return errorMessage(err, fallback);
}
