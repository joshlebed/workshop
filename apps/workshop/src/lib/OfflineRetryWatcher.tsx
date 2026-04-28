import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "../ui/Toast";
import { isOfflineError } from "./offline";

// Subscribes to the MutationCache and surfaces a "Retry?" toast whenever a
// mutation fails because the device is offline. Per-mutation `onError`
// handlers still run first (and revert their optimistic updates), so this is
// purely additive — the toast lets the user re-fire the mutation once the
// connection is back.
export function OfflineRetryWatcher() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  useEffect(() => {
    const cache = queryClient.getMutationCache();
    const seen = new Set<number>();
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const { mutation } = event;
      if (mutation.state.status !== "error") return;
      if (seen.has(mutation.mutationId)) return;
      if (!isOfflineError(mutation.state.error)) return;
      seen.add(mutation.mutationId);
      showToast({
        message: "You're offline. Couldn't save change.",
        tone: "danger",
        actionLabel: "Retry?",
        onAction: () => {
          mutation.execute(mutation.state.variables).catch(() => {});
        },
      });
    });
  }, [queryClient, showToast]);

  return null;
}
