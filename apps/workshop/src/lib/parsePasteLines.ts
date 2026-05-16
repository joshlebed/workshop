/**
 * Splits a paste blob into a clean, de-duplicated list of titles. Powers the
 * "Paste many" flow on the add screen.
 *
 * Drops blank lines; strips leading markers a user might have copied with
 * their list — "1.", "2)", "- ", "• ", "* "; trims surrounding whitespace.
 * Preserves order of first appearance. Truncates titles past the server's
 * 500-char `titleSchema` cap so one runaway line doesn't 400 the submit.
 */
export function parsePasteLines(blob: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of blob.split(/\r?\n/)) {
    const cleaned = raw.replace(/^\s*(?:\d+[.)]\s+|[-•*]\s+)/, "").trim();
    if (!cleaned) continue;
    const capped = cleaned.length > 500 ? cleaned.slice(0, 500) : cleaned;
    if (seen.has(capped)) continue;
    seen.add(capped);
    out.push(capped);
  }
  return out;
}
