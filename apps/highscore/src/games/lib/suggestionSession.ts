// Session-only state for the "What to play next" rail: whether a score was
// posted since launch, which surfaces were dismissed, whether the home rail
// latched on, and which impressions were already reported. Module memory on
// purpose — "per session" means until the app (or web tab) restarts.

import type { GameSuggestionSurface } from "@workshop/shared/constants";
import { useSyncExternalStore } from "react";

interface SessionState {
  scorePosted: boolean;
  homeLatched: boolean;
  dismissed: ReadonlySet<GameSuggestionSurface>;
}

let state: SessionState = {
  scorePosted: false,
  homeLatched: false,
  dismissed: new Set<GameSuggestionSurface>(),
};
const listeners = new Set<() => void>();
const reported = new Set<string>();

function set(next: Partial<SessionState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Every successful score post calls this (`usePostedScoreNotice`). */
export function noteScorePosted(): void {
  if (!state.scorePosted) set({ scorePosted: true });
}

export function latchHomeSuggestions(): void {
  if (!state.homeLatched) set({ homeLatched: true });
}

export function dismissSuggestions(surface: GameSuggestionSurface): void {
  if (state.dismissed.has(surface)) return;
  set({ dismissed: new Set([...state.dismissed, surface]) });
}

export function useSuggestionSession(): SessionState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** The game ids not yet reported as seen on `surface` this session; marks them. */
export function takeUnreportedImpressions(
  surface: GameSuggestionSurface,
  gameIds: readonly string[],
): string[] {
  const fresh = gameIds.filter((id) => !reported.has(`${surface}:${id}`));
  for (const id of fresh) reported.add(`${surface}:${id}`);
  return fresh;
}
