import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { startSpotifyAuthorize } from "../api/spotify";
import { API_URL } from "../config";
import { useAuth } from "./useAuth";

/**
 * Kicks off the Spotify OAuth dance:
 *   1. POST /v1/spotify/auth/authorize → backend mints a PKCE state row
 *      and returns the Spotify consent URL.
 *   2. We open the URL in the system browser (iOS/Android) or replace the
 *      current tab (web).
 *   3. Spotify redirects to the backend's /v1/spotify/auth/callback, which
 *      stores the tokens and redirects back to the app via SPOTIFY_APP_REDIRECT_URI
 *      with `?spotify=connected` (or `?spotify=error`).
 *
 * Web: we ask the backend to redirect back to the current page so the user
 * lands where they started. iOS will eventually need a `workshop://spotify`
 * deep link wired into app.json's `scheme`; that's a follow-up.
 */
export function useSpotifyConnect() {
  const { token } = useAuth();

  const mutation = useMutation({
    mutationFn: async () => {
      const appRedirect = computeAppRedirect();
      const res = await startSpotifyAuthorize(token, appRedirect);
      return res;
    },
    onSuccess: async (res) => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(res.authorizeUrl);
        return;
      }
      await Linking.openURL(res.authorizeUrl);
    },
  });

  const start = useCallback(() => {
    mutation.mutate();
  }, [mutation]);

  return {
    start,
    isStarting: mutation.isPending,
    error: mutation.error,
  };
}

function computeAppRedirect(): string | undefined {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // Strip query/hash so we don't accumulate stale `?spotify=...` params.
    const { protocol, host, pathname } = window.location;
    return `${protocol}//${host}${pathname}`;
  }
  // iOS/Android: rely on the app's `workshop://` scheme.
  // The backend will append `?spotify=connected` and the deep-link handler
  // re-renders the connect screen.
  if (API_URL.includes("localhost")) return "workshop://spotify";
  return "workshop://spotify";
}
