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
 * How many calendar days `date` sits behind `today` (0 = today, 1 =
 * yesterday). Future or malformed dates return 0 so callers can treat the
 * result as a safe rail offset.
 */
export function daysBack(date: string, today: string): number {
  const parse = (key: string): number | null => {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime();
  };
  const from = parse(date);
  const to = parse(today);
  if (from == null || to == null) return 0;
  const diff = Math.round((to - from) / 86_400_000);
  return diff > 0 ? diff : 0;
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

/**
 * The day heading the `DayHeader` strip shows: a short pixel-face line
 * ("TODAY", "YESTERDAY", "WED OCT 1") and a long system-face line with the
 * full date, so "which day am I looking at" reads at a glance and in full.
 */
export function formatDayHeading(
  date: string,
  today: string = localDateKey(),
): { short: string; long: string } {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return { short: date, long: date };
  const dt = new Date(y, m - 1, d);
  const long = dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: dt.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  if (date === today) return { short: "Today", long };
  if (date === shiftDateKey(today, -1)) return { short: "Yesterday", long };
  const short = dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return { short, long };
}
