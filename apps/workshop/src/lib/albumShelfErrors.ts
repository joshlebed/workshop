import { apiErrorCode, errorMessage } from "./apiError";

/**
 * Render a user-facing message for an error returned by the album-shelf
 * routes. The structured `details.code` (set by the backend's
 * `mapSpotifyError` and friends) carries the discriminator; we map each one
 * to a copy variant matching docs/album-shelf.md §11.
 */
export function albumShelfErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "INVALID_PLAYLIST_URL":
      return "That doesn't look like a Spotify playlist URL.";
    case "PLAYLIST_NOT_AVAILABLE":
      return "Source playlist is private or deleted. Update the source URL in settings.";
    case "SPOTIFY_UNAVAILABLE":
      return "Spotify is having a moment. Try again.";
    default:
      return errorMessage(err, fallback);
  }
}
