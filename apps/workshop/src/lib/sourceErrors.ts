import { apiErrorCode, errorMessage } from "@workshop/api-client/apiError";

/**
 * Two contexts where source errors surface, with subtly different copy.
 *
 *   "settings" — list already exists and is linked; the fix happens on
 *     Spotify / Letterboxd, then a sync picks it up.
 *   "creation" — list doesn't exist yet; the user is pasting a link into the
 *     create-list flow and can just try another one.
 *
 * Both contexts share the same backend error codes; only the user-facing copy
 * varies. Keeping the mapping in one place means a new code only has to be
 * handled once.
 */
export type SourceErrorContext = "settings" | "creation";

const COPY: Record<string, Record<SourceErrorContext, string>> = {
  // --- Spotify playlist ---
  INVALID_PLAYLIST_URL: {
    settings: "That isn't a Spotify playlist link. Check it and try again.",
    creation: "That isn't a Spotify playlist link. Check it and try again.",
  },
  PLAYLIST_NOT_AVAILABLE: {
    settings:
      "The linked playlist is private or deleted. Make it public on Spotify, then sync again.",
    creation: "That playlist isn't public. Make it public on Spotify and try again.",
  },
  SPOTIFY_UNAVAILABLE: {
    settings: "Spotify isn't responding. Try again in a moment.",
    creation: "Spotify isn't responding. Try again in a moment.",
  },
  // --- Letterboxd list ---
  INVALID_LETTERBOXD_URL: {
    settings: "That isn't a Letterboxd list link. Check it and try again.",
    creation: "That isn't a Letterboxd list link. Check it and try again.",
  },
  LIST_NOT_FOUND: {
    settings: "Couldn't find the linked Letterboxd list. Check that it still exists.",
    creation: "Couldn't find that Letterboxd list. Check the link and try again.",
  },
  LIST_NOT_AVAILABLE: {
    settings:
      "The linked Letterboxd list is private or deleted. Make it public on Letterboxd, then sync again.",
    creation: "That list isn't public. Make it public on Letterboxd and try again.",
  },
  LIST_FETCH_FAILED: {
    settings: "Letterboxd isn't responding. Try again in a moment.",
    creation: "Letterboxd isn't responding. Try again in a moment.",
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
