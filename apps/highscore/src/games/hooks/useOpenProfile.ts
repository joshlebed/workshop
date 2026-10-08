import { type Href, useRouter } from "expo-router";
import { useCallback } from "react";
import { useGamesRuntime } from "../runtime";

/**
 * Tapping a user's avatar or name anywhere in HighScore opens their profile
 * (`routes.friendProfile`). One hook so every surface — friends list,
 * standings rows, the per-game board, the invite card — lands on the same
 * screen; `FriendProfile` already handles self, friends and strangers.
 */
export function useOpenProfile(): (userId: string) => void {
  const router = useRouter();
  const { routes } = useGamesRuntime();
  return useCallback(
    (userId: string) => router.push(routes.friendProfile(userId) as Href),
    [router, routes],
  );
}
