/**
 * The current calendar day in the user's locale, formatted as YYYY-MM-DD.
 * Each daily-puzzle game decides which day a play belongs to using the
 * device's local calendar; mirroring that here keeps day boundaries aligned
 * with the score the player just pasted.
 */
export function localDateKey(d: Date = new Date()): string {
  // Use date-parts directly so we don't accidentally drift into UTC via
  // toISOString() (which would put east-of-UTC users in the wrong bucket
  // for plays made near midnight).
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Add (or subtract, with negatives) `delta` days to a YYYY-MM-DD string. */
export function shiftDateKey(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateKey(dt);
}

/**
 * Human-friendly label for a date relative to today. Returns "Today",
 * "Yesterday", or a longer locale-aware date for older days. Used in the
 * game-detail screen's date strip.
 */
export function formatGameDateLabel(date: string, today: string = localDateKey()): string {
  if (date === today) return "Today";
  if (date === shiftDateKey(today, -1)) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: dt.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Resolve a `?date=` route param to a day the DayRail can show: a valid
 * YYYY-MM-DD within `length` days of `today` (today inclusive). Anything
 * else — missing, malformed, future, older than the rail — falls back to
 * `today`, so a stale or hand-edited link never strands the board on a day
 * the rail can't select.
 */
export function resolveRailDate(
  raw: string | string[] | undefined,
  today: string,
  length: number,
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const oldest = shiftDateKey(today, -(length - 1));
  // Keys are zero-padded ISO dates, so string order is chronological.
  if (value > today || value < oldest) return today;
  // Reject calendar-invalid keys like 2026-02-31 (they'd never match a chip).
  return shiftDateKey(value, 0) === value ? value : today;
}
