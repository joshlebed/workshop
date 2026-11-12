import type { Item } from "@workshop/shared";

/** Case- and spacing-insensitive identity of a title, for duplicate checks. */
export function titleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Split pasted lines into the ones to add and the ones already on the list
 * (case-insensitive, 2.4). The paste is already de-duplicated within itself.
 */
export function splitAgainstList(
  lines: readonly string[],
  existing: readonly { title: string }[],
): { fresh: string[]; skipped: string[] } {
  const seen = new Set(existing.map((i) => titleKey(i.title)));
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const line of lines) (seen.has(titleKey(line)) ? skipped : fresh).push(line);
  return { fresh, skipped };
}

/**
 * Which search results are already "On list" (2.5): an item from the same
 * source record, or a hand-typed item with the same title and, where both
 * know one, the same year. A hand-typed title with no year claims only the
 * first (best-ranked) result of that name, so typing "Past Lives" once doesn't
 * mark every film called that.
 */
export function onListResultIds(
  results: readonly { id: string; title: string; year?: number | null }[],
  items: readonly Item[],
): Set<string> {
  const out = new Set<string>();
  const bySource = new Set<string>();
  const yearless = new Set<string>();
  const withYear = new Set<string>();
  for (const it of items) {
    const c = it.content as { sourceId?: unknown; year?: unknown };
    if (typeof c.sourceId === "string") bySource.add(c.sourceId);
    else if (typeof c.year === "number") withYear.add(`${titleKey(it.title)}|${c.year}`);
    else yearless.add(titleKey(it.title));
  }
  const claimed = new Set<string>();
  for (const r of results) {
    const key = titleKey(r.title);
    if (bySource.has(r.id) || (r.year != null && withYear.has(`${key}|${r.year}`))) {
      out.add(r.id);
    } else if (yearless.has(key) && !claimed.has(key)) {
      claimed.add(key);
      out.add(r.id);
    }
  }
  return out;
}
