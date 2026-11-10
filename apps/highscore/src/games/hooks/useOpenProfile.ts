import { type Href, useRouter } from "expo-router";
import { useCallback } from "react";
import { useGamesRuntime } from "../runtime";

/**
 * Tapping a user's avatar or name anywhere in HighScore opens their profile
 * (`routes.friendProfile`). One hook so every surface — friends list,
 * standings rows, the per-game board, the invite card — lands on the same
 * screen; `FriendProfile` already handles self, friends and strangers.
 */
export function useOpenProfile(): (userId: string, via?: string) => void {
  const router = useRouter();
  const { routes } = useGamesRuntime();
  return useCallback(
    // `via`: a play-link token that vouches the viewer past the profile's
    // anti-probe 404 for a sharer they aren't friends with yet.
    (userId: string, via?: string) => router.push(routes.friendProfile(userId, via) as Href),
    [router, routes],
  );
}
