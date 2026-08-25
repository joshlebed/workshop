import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Drives TanStack Query's `refetchInterval` for the multiplayer-bearing
 * screens (home / activity / list-detail). When the document is visible
 * the hook returns 15s; when the tab is backgrounded it returns `false`
 * to pause the poll (React Query treats `false` as "don't refetch").
 *
 * This is a deliberate substitute for a real server-push transport. SSE
 * via Lambda Function URLs (or a WebSocket API) is the natural next step
 * — see PR description. Polling at 15s keeps the surface within a couch-
 * scenario "feels live" window without burning a connection slot per user
 * or rewriting the API Gateway / Lambda layer.
 *
 * Native (iOS) returns `false` unconditionally — React Native's existing
 * `AppState` → focusManager integration in `@tanstack/react-query` already
 * triggers refetches on app foreground via `refetchOnWindowFocus`, and a
 * background timer would be a battery tax we don't want to ship.
 */
export function useLivePollingInterval(): number | false {
  const [visible, setVisible] = useState<boolean>(() => {
    if (Platform.OS !== "web") return false;
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const handler = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  if (Platform.OS !== "web") return false;
  return visible ? 15_000 : false;
}
