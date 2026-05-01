import type { Context } from "hono";
import { err } from "../response.js";
import {
  PlaylistNotAvailableError,
  SpotifyApiError,
  SpotifyAuthError,
  SpotifyConfigError,
} from "./app-client.js";

/**
 * Map a known Spotify error to its v1 error envelope. Returns `null` for
 * anything we don't recognise so the caller can re-throw — the same convention
 * the route handlers used inline before this helper existed. Keeping the
 * mapping in one place means the structured error codes
 * (`PLAYLIST_NOT_AVAILABLE`, `SPOTIFY_UNAVAILABLE`) stay in sync across the
 * three call sites that handle Spotify failures.
 */
export function mapSpotifyError(c: Context, e: unknown): Response | null {
  if (e instanceof PlaylistNotAvailableError) {
    return err(c, "VALIDATION", "playlist not found or private", {
      code: "PLAYLIST_NOT_AVAILABLE",
    });
  }
  if (e instanceof SpotifyConfigError) {
    return err(c, "INTERNAL", "spotify integration not configured");
  }
  if (e instanceof SpotifyAuthError || e instanceof SpotifyApiError) {
    return err(c, "INTERNAL", "spotify upstream error", { code: "SPOTIFY_UNAVAILABLE" });
  }
  return null;
}
