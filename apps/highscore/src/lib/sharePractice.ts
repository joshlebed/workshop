// In-memory signal for the share-setup walkthrough's practice share. When the
// user taps HighScore in the walkthrough's live share sheet, the payload comes
// back through the share extension to `_layout.tsx`, which calls
// `markSharePracticeReceived()`. A walkthrough already on screen flips to its
// "It works" state from this signal rather than from navigation: replacing the
// route it is already on proved unreliable. A walkthrough that isn't mounted
// gets `?tested=1` instead.

import { useSyncExternalStore } from "react";

let receivedAt = 0;
const listeners = new Set<() => void>();

export function markSharePracticeReceived(now = Date.now()): void {
  receivedAt = now;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Epoch ms of the latest practice share, 0 before the first. */
export function useSharePracticeReceivedAt(): number {
  return useSyncExternalStore(
    subscribe,
    () => receivedAt,
    () => receivedAt,
  );
}
