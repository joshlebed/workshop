// Cartridge plate monograms. Pure and dependency-free so it stays unit
// testable — the plate that renders it pulls in the theme (and therefore
// react-native), which vitest can't collect.

function wordsOf(title: string): string[] {
  return title
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** "NYT Mini" → "NY", "Daily Tens" → "DT", "Satle" → "SA". */
export function monogramFor(title: string): string {
  const words = wordsOf(title);
  if (words.length === 0) return "??";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * Monograms for a whole deck. "Travle" and "Tradle" both want TR, and two
 * identical plates side by side defeat the point of a label — so the second
 * character walks forward until the plate is unique within the deck.
 */
export function monogramsFor(titles: string[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const title of titles) {
    const first = monogramFor(title)[0] ?? "?";
    const rest = [...wordsOf(title).join("")].slice(1);
    let mark = monogramFor(title);
    if (taken.has(mark)) {
      const alt = rest
        .map((c) => `${first}${c}`.toUpperCase())
        .find((candidate) => !taken.has(candidate));
      mark = alt ?? mark;
    }
    taken.add(mark);
    out.set(title, mark);
  }
  return out;
}
