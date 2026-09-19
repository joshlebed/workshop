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

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { localDateKey } from "../lib/gameDate";

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

interface ViewDayValue {
  viewDate: string;
  setViewDate: (date: string) => void;
}

const ViewDayContext = createContext<ViewDayValue | null>(null);

export function ViewDayProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredViewDay | null>(null);
  const today = localDateKey();
  const viewDate = resolveViewDay(stored, today);
  const setViewDate = useCallback((date: string) => {
    setStored({ date, anchorToday: localDateKey() });
  }, []);
  return (
    <ViewDayContext.Provider value={{ viewDate, setViewDate }}>{children}</ViewDayContext.Provider>
  );
}

export function useViewDay(): ViewDayValue {
  const value = useContext(ViewDayContext);
  if (!value) throw new Error("useViewDay must be used inside ViewDayProvider");
  return value;
}
