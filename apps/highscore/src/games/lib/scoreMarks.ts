// Turn a game's distilled share text into something a leaderboard row can
// actually rank on: one result token plus, where the share carries a grid, a
// strip of coloured marks.
//
// Every daily game invents its own share format, so the rows used to print
// whatever the provider wrote — "99🎯 97🔥 99🎯 98🎯 100🎯 / Final score: 988"
// — wrapping mid-row and dropping emoji into a pixel face that can't hold
// them. This module pulls out the two things a standings row needs and throws
// the provider's copy away.

/**
 * Semantic mark kinds. Deliberately not colours: this module stays free of
 * the theme (and of react-native) so it is a plain unit under test, and the
 * renderer owns the palette mapping.
 */
export type MarkKind = "hit" | "near" | "warm" | "miss" | "alt" | "blank";

const MARK_KINDS: Record<string, MarkKind> = {
  "🟩": "hit",
  "✅": "hit",
  "🟢": "hit",
  "🟨": "near",
  "🟡": "near",
  "🟠": "warm",
  "🟧": "warm",
  "🔴": "miss",
  "🟥": "miss",
  "❌": "miss",
  "🟪": "alt",
  "🟣": "alt",
  "🟦": "alt",
  "🔵": "alt",
  "⬜": "blank",
  "⬛": "blank",
  "◻": "blank",
  "◼": "blank",
  "⚪": "blank",
  "⚫": "blank",
};

export interface DistilledScore {
  /** The one thing worth ranking on — "4/6", "+1", "988", "Perfect". */
  token: string | null;
  /** A single-line grid. Empty when the share doesn't carry one. */
  marks: MarkKind[];
  /** A multi-line grid, row by row. Empty when the share doesn't carry one. */
  grid: MarkKind[][];
  /** Whatever is left when nothing above matched — shown verbatim, rarely. */
  text: string | null;
}

/**
 * A grid row is any line carrying at least three marks — games happily put
 * the token on the same line as the grid ("🟥🟥🟥🟥🟩⬜ 5/6").
 */
const MIN_ROW_MARKS = 3;

function marksOf(line: string): MarkKind[] {
  const out: MarkKind[] = [];
  for (const c of line) {
    const kind = MARK_KINDS[c];
    if (kind) out.push(kind);
  }
  return out;
}

/** Ordered: the more specific the shape, the earlier it wins. */
const TOKEN_PATTERNS: RegExp[] = [
  /\b([\dX]+\/\d+)\b/i, // 4/6, X/6
  /\((Perfect)\)/i, // travle
  /(?:final\s+score|score)\s*[:=]?\s*([\d,]+)/i, // maptap, anthropeum
  /(\+\d+)/, // travle
  /\b(\d[\d,]{2,})\b/, // bare big number
  /\b(\d{1,2})\s+(?:guesses|tries|hints?)\b/i,
];

function tokenOf(text: string): string | null {
  for (const pattern of TOKEN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * `body` is the output of `summarizeGameScoreBody` — already stripped of URLs
 * and header lines by the game registry. This is the last step: separate the
 * rankable token from the picture.
 */
export function distillScore(body: string | null): DistilledScore {
  if (!body) return { token: null, marks: [], grid: [], text: null };
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rows = lines.map(marksOf).filter((m) => m.length >= MIN_ROW_MARKS);
  const token = tokenOf(lines.join(" "));

  // A share whose grid is one line reads as a strip beside the token; a
  // multi-row grid *is* the score, so it keeps its shape.
  const marks = rows.length === 1 ? (rows[0] ?? []).slice(0, 10) : [];
  const grid = rows.length > 1 ? rows.slice(0, 8).map((r) => r.slice(0, 10)) : [];

  // Only fall back to raw text when there is nothing structured at all.
  const leftover = lines
    .filter((l) => marksOf(l).length < MIN_ROW_MARKS)
    .join(" ")
    .trim();
  const text = token || marks.length > 0 || grid.length > 0 ? null : leftover || null;

  return { token, marks, grid, text };
}
