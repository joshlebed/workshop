// PROTOTYPE — reorder-discoverability options for the Games home, switchable
// at runtime so each can be tried in the preview before one is chosen.
//
//   off    — today's behaviour (hidden long-press / drag only)
//   menu   — "Move to top / up / down" rows in the card's ⋯ menu + a tip line
//   coach  — one-time dismissable "press and hold to reorder" card over the list
//   handle — a visible grip glyph on every card
//
// The mode is read from `?reorderHint=<mode>` on web, else from local storage,
// and the chip row at the top of the home writes it back. Dismissal of the
// coach mark is local here; production would use `user_flags`.

import { getItem, setItem } from "@workshop/api-client/storage";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

export const REORDER_HINT_MODES = ["off", "menu", "coach", "handle"] as const;
export type ReorderHintMode = (typeof REORDER_HINT_MODES)[number];

export const REORDER_HINT_LABELS: Record<ReorderHintMode, string> = {
  off: "Off",
  menu: "A · Menu",
  coach: "B · Coach mark",
  handle: "C · Grip",
};

const MODE_KEY = "hs.proto.reorderHint.mode";
const COACH_DISMISSED_KEY = "hs.proto.reorderHint.coachDismissed";

function isMode(value: unknown): value is ReorderHintMode {
  return typeof value === "string" && (REORDER_HINT_MODES as readonly string[]).includes(value);
}

function modeFromUrl(): ReorderHintMode | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("reorderHint");
  return isMode(value) ? value : null;
}

export function useReorderHintPrototype() {
  const [mode, setModeState] = useState<ReorderHintMode>("off");
  const [coachDismissed, setCoachDismissedState] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromUrl = modeFromUrl();
      const stored = await getItem(MODE_KEY);
      const dismissed = await getItem(COACH_DISMISSED_KEY);
      if (cancelled) return;
      const resolved = fromUrl ?? (isMode(stored) ? stored : "off");
      setModeState(resolved);
      if (fromUrl) void setItem(MODE_KEY, fromUrl);
      setCoachDismissedState(dismissed === "1");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ReorderHintMode) => {
    setModeState(next);
    void setItem(MODE_KEY, next);
    // Re-picking the coach mark re-arms it so it can be reviewed again.
    if (next === "coach") {
      setCoachDismissedState(false);
      void setItem(COACH_DISMISSED_KEY, "0");
    }
  }, []);

  const dismissCoach = useCallback(() => {
    setCoachDismissedState(true);
    void setItem(COACH_DISMISSED_KEY, "1");
  }, []);

  return { mode, setMode, coachDismissed, dismissCoach };
}
