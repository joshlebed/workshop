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
