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
  // Long runs wrap across multiple grid lines; the final line ends `= N`.
  globle(raw) {
    const lines = nonEmptyLines(stripUrlSubstrings(raw));
    const gridStart = lines.findIndex(isGridOnlyLine);
    if (gridStart === -1) return null;
    let gridEnd = -1;
    for (let i = gridStart; i < lines.length; i++) {
      if (/=\s*\d+\s*$/.test(lines[i]!)) {
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

  // Shape: `DailyTens #751\n\n     🏆    ❌\n     🏆    🏆\n...`
  // Drop the `DailyTens #N` header — the `• Daily Tens` bullet already labels
  // the block — and keep the 5-row 🏆/❌ grid verbatim (leading whitespace
  // matters: it aligns the two columns).
  dailytens(raw) {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.replace(URL_RE, "").trimEnd())
      .filter((l) => l.trim().length > 0)
      .filter((l) => !/^\s*DailyTens\b/i.test(l));
    return lines.length ? lines.join("\n") : null;
  },

  // Shape: `I solved the 5/20/2026 New York Times Mini Crossword in 0:16!`
  // No grid — just pull the `M:SS` solve time off the end.
  "nyt-mini"(raw) {
    const time = stripUrlSubstrings(raw).match(/\b\d+:\d{2}\b/)?.[0];
    return time ?? null;
  },
};

// A "grid-only" line carries only emoji / box-drawing / checkmarks plus an
// optional `= N` suffix — i.e. no readable English text. Used by per-game
// formatters to pick the visual grid block out of the raw share.
function isGridOnlyLine(line: string): boolean {
  return !/[A-Za-z0-9]/.test(line.replace(/=\s*\d+\s*$/, ""));
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
 * heuristics handle the four games we explicitly support (maptap, Globle,
 * Satle, travle); everything else falls back to a cleaned copy of the raw
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
