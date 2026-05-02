import { apiErrorCode, errorMessage } from "./apiError";

/**
 * Two contexts where album-shelf errors surface, with subtly different copy.
 *
 *   "settings" — list already exists; "Update the source URL in settings" is
 *     valid actionable advice.
 *   "creation" — list doesn't exist yet; the user is pasting a URL into the
 *     create-shelf flow, so settings-deep-link copy doesn't apply.
 *
 * Both contexts share the same backend error codes; only the user-facing copy
 * varies. Keeping the mapping in one place means a new code only has to be
 * handled once.
 */
export type AlbumShelfErrorContext = "settings" | "creation";

const COPY: Record<string, Record<AlbumShelfErrorContext, string>> = {
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
};

/**
 * Render a user-facing message for an error returned by the album-shelf
 * routes. The structured `details.code` (set by the backend's
 * `mapSpotifyError` and friends) carries the discriminator; we map each one
 * to a copy variant matching docs/album-shelf.md §11.
 */
export function albumShelfErrorMessage(
  err: unknown,
  fallback: string,
  context: AlbumShelfErrorContext = "settings",
): string {
  const code = apiErrorCode(err);
  if (code && COPY[code]) return COPY[code][context];
  return errorMessage(err, fallback);
}
