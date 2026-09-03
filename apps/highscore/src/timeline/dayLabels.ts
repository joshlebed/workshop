// Day headings for the timeline spine.
//
// Two strings per day, never one: a `label` that says where you are relative to
// now ("TODAY", "YESTERDAY", "SAT") and a `date` that says which day that
// actually was ("3 SEP"). The sticky marker shows the label; the section header
// shows both, so scrolling back six days never leaves you guessing.

import { shiftDateKey } from "../games/lib/gameDate";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export interface DayHeading {
  label: string;
  date: string;
}

function parts(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function dayHeading(dateKey: string, today: string): DayHeading {
  const dt = parts(dateKey);
  const date = dt ? `${dt.getDate()} ${MONTHS[dt.getMonth()]}` : dateKey;
  if (dateKey === today) return { label: "TODAY", date };
  if (dateKey === shiftDateKey(today, -1)) return { label: "YESTERDAY", date };
  return { label: dt ? (WEEKDAYS[dt.getDay()] ?? date) : date, date };
}

/** The `count` days ending the day before `today`, most recent first. */
export function pastDayKeys(today: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= count; i += 1) keys.push(shiftDateKey(today, -i));
  return keys;
}
