// Pure helpers behind the DaySpine control — the strip's 7-day window and the
// headline label. Kept out of the component so the rollover rules are
// unit-testable without a renderer.

import { daysBack, shiftDateKey } from "../games/lib/gameDate";

export const SPINE_LENGTH = 7;

/**
 * The seven consecutive day keys the strip shows, oldest first. The window
 * ends on today unless the selected day is older than the window, in which
 * case it ends on the selected day — so the selection is always visible and
 * stepping forward out of an old window slides it back toward today.
 */
export function spineWindow(viewDate: string, today: string): string[] {
  const oldestInDefault = shiftDateKey(today, -(SPINE_LENGTH - 1));
  const end = viewDate < oldestInDefault ? viewDate : today;
  const keys: string[] = [];
  for (let i = SPINE_LENGTH - 1; i >= 0; i -= 1) keys.push(shiftDateKey(end, -i));
  return keys;
}

export interface SpineLabel {
  /** "TODAY" / "YESTERDAY" / null for older days. */
  relative: string | null;
  /** "WED OCT 8" (adds the year when it isn't this year). */
  absolute: string;
}

/** Headline for the date line under the strip. Always ALL CAPS — it is set in Press Start 2P. */
export function spineLabel(viewDate: string, today: string): SpineLabel {
  const back = daysBack(viewDate, today);
  const relative = viewDate === today ? "TODAY" : back === 1 ? "YESTERDAY" : null;
  const [y, m, d] = viewDate.split("-").map(Number);
  if (!y || !m || !d) return { relative, absolute: viewDate };
  const dt = new Date(y, m - 1, d);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  const absolute = dt
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    })
    .replace(/,/g, "")
    .toUpperCase();
  return { relative, absolute };
}

/** Single-letter weekday for a strip cell. */
export function weekdayInitial(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
}

/** Day-of-month, as the strip cell prints it. */
export function dayOfMonth(date: string): string {
  const d = Number(date.split("-")[2]);
  return Number.isFinite(d) ? String(d) : "";
}

/** The month a day key belongs to, as `YYYY-MM`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Every day key of `month` (`YYYY-MM`) laid out on a Monday-first grid. The
 * first week is padded with the previous month's trailing days (callers blank
 * them out by `monthOf`), so every cell has a real, unique key.
 */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  // JS: 0 = Sunday. Monday-first offset.
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: string[] = [];
  for (let i = -lead; i < daysInMonth; i += 1) cells.push(shiftDateKey(first, i));
  return cells;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1)
    .toLocaleDateString(undefined, { month: "long", year: "numeric" })
    .toUpperCase();
}
