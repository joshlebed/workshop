import type { Item, LeaderboardEntry } from "@workshop/shared";
import {
  type DetectedSharedScoreKind,
  detectGameKindForItem,
  detectSharedScore,
} from "./shareScoreDetection";

interface BuildSummaryParams {
  listName: string;
  listUrl: string;
  items: Item[];
  scoresByItem: Record<string, LeaderboardEntry[]>;
  selfId: string | null;
  dateKey: string;
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

// A Globle grid's final line ends `= N`. Players sometimes hand-append a marker
// after it — real prod shares carry `= 13(cheated)` (a manual, non-genuine-score
// callout people add before sharing anyway). It's freeform human text, so match
// `= N` plus whatever trails it to end-of-line rather than a fixed `(cheated)`
// shape; that keeps the grid-block trimming from falling through to the raw
// date/avg header (the bug), while the marker stays on the score line so the
// recap shows the score was flagged. Globle only ever puts `=` on the grid's
// score line, so matching it anywhere on the line is unambiguous.
const GRID_SCORE_TAIL = /=\s*\d+.*$/;

function stripUrlSubstrings(text: string): string {
  return text.replace(URL_RE, "");
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

type Formatter = (scoreRaw: string) => string | null;

// Per-game heuristics distilling the raw clipboard share into a tight,
// human-readable block. Each formatter receives the original `scoreRaw`
// and returns the body to show under the `• <title>` bullet, or `null`
// to defer to the generic fallback.
const FORMATTERS: Partial<Record<DetectedSharedScoreKind, Formatter>> = {
  // Shape: `www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770`
  // Drop the URL/date header line; keep the per-round scoreline and the
  // Final score line verbatim.
  maptap(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw)).filter(
      (l) => !/^(?:www\.)?maptap\.gg\b/i.test(l),
    );
    return lines.length ? lines.join("\n") : null;
  },

  // Shape: `🌎 May 27, 2026 🌍\n🔥 1 | Avg. Guesses: 8.4\n⬜🟨⬜🟧🟩 = 5\n\nhttps://globle-game.com\n#globle`
  // Long runs wrap across multiple grid lines; the final line ends `= N`, with
  // an optional hand-typed marker like `(cheated)` after it (see GRID_SCORE_TAIL).
  globle(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw));
    const gridStart = lines.findIndex(isGridOnlyLine);
    if (gridStart === -1) return null;
    let gridEnd = -1;
    for (let i = gridStart; i < lines.length; i++) {
      if (GRID_SCORE_TAIL.test(lines[i]!)) {
        gridEnd = i;
        break;
      }
    }
    if (gridEnd === -1) return null;
    return lines.slice(gridStart, gridEnd + 1).join("\n");
  },

  // Shape: `🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩\nhttps://satle.ca`
  // Pull the `N/6` fraction off the header and append it to the grid.
  satle(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw));
    const header = lines.find((l) => /satle/i.test(l));
    const grid = lines.find((l) => isGridOnlyLine(l) && !/satle/i.test(l));
    const fraction = header?.match(/(\d+|X)\/\d+/i)?.[0];
    if (!grid || !fraction) return null;
    return `${grid} ${fraction}`;
  },

  // Shape: `#travle #1260 +2\n🟧✅🟩🟧🟩✅✅\nhttps://travle.earth`
  // (perfect: `#travle #1251 +0 (Perfect)`)
  // Pull the `+N` (with optional parenthetical) off the header and append.
  travle(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw));
    const header = lines.find((l) => /travle/i.test(l));
    const grid = lines.find((l) => isGridOnlyLine(l) && !/travle/i.test(l));
    const score = header?.match(/[+-]\d+(?:\s*\([^)]+\))?/)?.[0];
    if (!grid || !score) return null;
    return `${grid} ${score}`;
  },

  // Shape: `DailyTens #751\n\n     🏆    ❌\n     🏆    🏆\n...` — a 5-row × 2-col
  // 🏆/❌ grid. Drop the `DailyTens #N` header (the `• Daily Tens` bullet already
  // labels the block) and the column-aligning whitespace, then **transpose** the
  // grid to two rows of five: the left column (top→bottom) becomes the first row,
  // the right column the second. 6 lines collapse to 2. Require at least one grid
  // line so a URL-only share doesn't slip through with just the dailytens.com ref.
  dailytens(raw) {
    const cellRows = raw
      .split(/\r?\n/)
      .map((l) => [...l.replace(URL_RE, "").matchAll(/[🏆❌]/gu)].map((m) => m[0]))
      .filter((cells) => cells.length > 0);
    if (cellRows.length === 0) return null;
    const width = cellRows[0]!.length;
    // Only transpose a well-formed rectangular grid; otherwise defer to fallback.
    if (width === 0 || cellRows.some((r) => r.length !== width)) return null;
    const rows: string[] = [];
    for (let c = 0; c < width; c++) {
      rows.push(cellRows.map((r) => r[c]).join(""));
    }
    return rows.join("\n");
  },

  // Shape: `#Tradle #1548 6/6\n🟩🟩⬜⬜⬜\n🟩🟩🟩⬜⬜\n…\n🟩🟩🟩🟩🟩\nhttps://tradle.net/`
  // The grid's signal is "how many greens per guess until you nailed it", so
  // collapse each guess row to its 🟩 count into a single sparkline and suffix the
  // `N/6` (or `X/6`) fraction from the header — `🟩 2·3·4·4·4·5 6/6`. Six grid
  // lines collapse to one. Require at least one grid line so a URL-only share
  // (grid dropped by the iOS share sheet) defers to the fallback.
  tradle(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw));
    const greens = lines
      .filter((l) => isGridOnlyLine(l) && /[🟩🟨🟧🟥⬜]/u.test(l))
      .map((l) => (l.match(/🟩/gu) ?? []).length);
    if (greens.length === 0) return null;
    const fraction = lines.find((l) => /tradle/i.test(l))?.match(/(?:\d+|X)\/\d+/i)?.[0];
    const sparkline = `🟩 ${greens.join("·")}`;
    return fraction ? `${sparkline} ${fraction}` : sparkline;
  },

  // Shape: `I solved the 5/20/2026 New York Times Mini Crossword in 0:16!`
  // No grid — render the `M:SS` solve time as keycap-emoji digits so the
  // bullet has a visual analogue to the grids the other games emit.
  "nyt-mini"(raw) {
    const time = stripUrlSubstrings(raw).match(/\b\d+:\d{2}\b/)?.[0];
    return time ? toKeycapDigits(time) : null;
  },
};

// A "grid-only" line carries only emoji / box-drawing / checkmarks plus an
// optional `= N` suffix — i.e. no readable English text. Used by per-game
// formatters to pick the visual grid block out of the raw share.
function isGridOnlyLine(line: string): boolean {
  return !/[A-Za-z0-9]/.test(line.replace(GRID_SCORE_TAIL, ""));
}

const KEYCAP_DIGITS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

function toKeycapDigits(text: string): string {
  return text.replace(/\d/g, (d) => KEYCAP_DIGITS[Number(d)]!);
}

/**
 * Fallback formatter for games without a specific heuristic: strip embedded
 * URLs, drop pure-hashtag lines (`#globle`, `#dailygame`) and blank lines,
 * and otherwise preserve the raw text — including leading whitespace, which
 * some games (Daily Tens) use to align grids. Returns `null` if nothing's
 * left worth showing.
 */
function fallbackFormat(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(URL_RE, "").trimEnd())
    .filter((l) => l.trim().length > 0)
    .filter((l) => !/^\s*#\S+\s*$/.test(l));
  return lines.length ? lines.join("\n") : null;
}

function detectKind(item: Item, scoreRaw: string): DetectedSharedScoreKind | null {
  return detectSharedScore(scoreRaw)?.kind ?? detectGameKindForItem(item);
}

/**
 * Render `scoreRaw` (and `scoreValue` as a last resort) into the body shown
 * under a `• <title>` bullet in the clipboard recap. Game-specific
 * heuristics handle the games we explicitly support (maptap, Globle, Satle,
 * travle, Daily Tens, Tradle, NYT Mini); everything else falls back to a cleaned copy of the raw
 * text, and finally to the numeric scoreValue if even that yields nothing.
 */
export function summarizeScoreBody(
  item: Item,
  entry: { scoreValue: number | null; scoreRaw: string | null },
): string | null {
  const raw = entry.scoreRaw ?? "";
  if (raw.trim()) {
    const kind = detectKind(item, raw);
    const formatter = kind ? FORMATTERS[kind] : undefined;
    const formatted = formatter?.(raw);
    if (formatted && formatted.trim().length > 0) return formatted;
    const fallback = fallbackFormat(raw);
    if (fallback && fallback.trim().length > 0) return fallback;
    // Raw was non-empty but stripped to nothing — almost always a URL-only
    // share. `scoreValue` here is whatever number the backend's "first number
    // anywhere" parser pulled from URL query params (e.g. `?ref=944415`), so
    // surface nothing rather than a meaningless digit string.
    return null;
  }
  if (entry.scoreValue !== null && Number.isFinite(entry.scoreValue)) {
    return String(entry.scoreValue);
  }
  return null;
}

/** Locale-aware short date (e.g. "May 27"). No relative labels — the recap
 *  is for a chat conversation where "Today" reads as ambiguous after a few
 *  hours. */
function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Compose a clipboard-friendly recap of the viewer's own scores on `dateKey`.
 * One bullet per game with a per-game-distilled body underneath; a single
 * trailing link back to the list. Returns `null` when the viewer has
 * nothing to share — caller surfaces a "no scores" toast instead of
 * copying an empty string.
 */
export function buildTodaysScoresSummary({
  listName,
  listUrl,
  items,
  scoresByItem,
  selfId,
  dateKey,
}: BuildSummaryParams): string | null {
  if (!selfId) return null;

  const blocks: string[] = [];
  for (const item of items) {
    const entries = scoresByItem[item.id];
    if (!entries) continue;
    const mine = entries.find((e) => e.userId === selfId);
    if (!mine) continue;
    const body = summarizeScoreBody(item, mine);
    if (!body) continue;
    blocks.push(`• ${item.title}\n${body}`);
  }

  if (blocks.length === 0) return null;

  const header = `My scores in ${listName} — ${formatShortDate(dateKey)}`;
  return `${header}\n${blocks.join("\n")}\n${listUrl}`;
}
