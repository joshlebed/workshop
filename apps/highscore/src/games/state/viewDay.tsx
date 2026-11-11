// Shared "which day am I looking at" state for the Games surfaces.
//
// The home day rail and each game board's day rail are the same control over
// the same concept, so the selection is one piece of state: pick "Yesterday"
// on home and the board opens on yesterday; page back to Friday on a board
// and home is on Friday when you return. Both screens stay controlled — this
// is just where the value lives.
//
// The selection is anchored to the day it was made: on the first render of a
// new calendar day the stale pick snaps back to today (a daily-games app
// should greet you with today, not the day you left it on last night).
//
// "Today" itself is live state, not a per-render `localDateKey()` call. iOS
// keeps a suspended app in memory for days, and coming back to the foreground
// re-renders nothing by itself — with a per-render read, an app left on
// yesterday evening's screen still showed yesterday the next morning until
// some query happened to return different data. `useLiveToday` re-reads the
// clock when the app becomes active and at local midnight, so every surface
// that reads `today` from here re-renders onto the new day.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { localDateKey, msUntilNextLocalMidnight } from "../lib/gameDate";

interface StoredViewDay {
  date: string;
  /** What "today" was when the selection was made. */
  anchorToday: string;
}

/**
 * Resolve a stored selection against the current day. Pure so the rollover
 * rules are unit-testable: selections from a previous day reset to today, as
 * do future dates (clock changes) — same-day past picks stick.
 */
export function resolveViewDay(stored: StoredViewDay | null, today: string): string {
  if (!stored) return today;
  if (stored.anchorToday !== today) return today;
  if (stored.date > today) return today;
  return stored.date;
}

/**
 * The current local calendar day as state that tracks the clock: re-read on
 * every foreground (`AppState` → `active`; react-native-web maps this onto
 * page visibility) and at the next local midnight while the app stays open.
 */
function useLiveToday(): string {
  const [today, setToday] = useState(localDateKey);
  useEffect(() => {
    const refresh = () => setToday(localDateKey());
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    // One-shot per day: re-arm after each rollover rather than a fixed
    // interval, so DST transitions land exactly on the calendar boundary.
    // The extra second keeps a timer that fires early from re-reading the
    // old day and then waiting 24h.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextLocalMidnight() + 1000);
    };
    arm();
    return () => {
      sub.remove();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return today;
}

interface ViewDayValue {
  /** Today's YYYY-MM-DD, live (see `useLiveToday`). */
  today: string;
  viewDate: string;
  setViewDate: (date: string) => void;
}

const ViewDayContext = createContext<ViewDayValue | null>(null);

export function ViewDayProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredViewDay | null>(null);
  const today = useLiveToday();
  const viewDate = resolveViewDay(stored, today);
  const setViewDate = useCallback((date: string) => {
    setStored({ date, anchorToday: localDateKey() });
  }, []);
  return (
    <ViewDayContext.Provider value={{ today, viewDate, setViewDate }}>
      {children}
    </ViewDayContext.Provider>
  );
}

export function useViewDay(): ViewDayValue {
  const value = useContext(ViewDayContext);
  if (!value) throw new Error("useViewDay must be used inside ViewDayProvider");
  return value;
}

/**
 * Today's YYYY-MM-DD for query keys and "Today" labels. Prefer this over a
 * render-time `localDateKey()` in any screen: it re-renders the caller when
 * the day rolls over (foreground after midnight, or midnight while open).
 */
export function useToday(): string {
  return useViewDay().today;
}
