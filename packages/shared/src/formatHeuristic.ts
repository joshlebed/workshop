// PROTOTYPE — a smarter default for games with no `format_code`, used only by
// the HighScore formatter-preview flow (`POST /v1/games/:id/formatter/preview`).
// The existing `formatShareBodyFallback` in `gameRegistry.ts` is untouched.
//
// Both functions here are SELF-CONTAINED on purpose: the backend stores
// `String(formatShareBodyHeuristic)` / `String(findScoreLine)` verbatim as a
// game's format code (`lib/gameCode/heuristicFormat.ts`), so the body may not
// reference anything outside itself — no module constants, no imports, no
// sibling helpers. `heuristicFormat.test.ts` runs the stored block in the real
// QuickJS sandbox and fails if this function stops being portable.
//
// Conventions follow the hand-written formatters (`lib/gameCode/handwritten.ts`):
// drop the header, URLs and hashtag lines; keep the visual grid; keep the
// line the score came from.

export interface HeuristicFormatOptions {
  /** The game's title; a line naming it near the top is the header. */
  title?: string | null | undefined;
  /** The line the parser's score came from (`findScoreLine`), when known. */
  scoreLine?: string | null | undefined;
}

/**
 * A recap summary for a share with no game-specific formatter, or null when
 * nothing distinctive is left (the caller shows the cleaned raw text).
 *
 * - URLs (bare and `<angle-bracketed>`), hashtag-only lines and rule lines
 *   (`─────`) go.
 * - The header goes: among the first two lines, before the grid, a line that
 *   names the game, carries `#N` / `No. N`, or a date.
 * - Kept, in order: grid-only lines (no letters or digits, a trailing number
 *   allowed), the score line, rows of `·`-separated tokens, and short
 *   emoji-led stat lines ("🏆 Perfect game").
 * - With no score line known and no grid, short lines carrying a number.
 * - When the score sits in the header and there is no grid, the header minus
 *   its title / puzzle number / date is kept as the last line.
 * - One grid line plus a bare number becomes one line ("🦑🏮🐟 360").
 */
export function formatShareBodyHeuristic(
  raw: string,
  options?: HeuristicFormatOptions,
): string | null {
  const opts = options || {};
  const title = String(opts.title || "").trim();
  const scoreLine = opts.scoreLine ? clean(opts.scoreLine) : "";
  const DATE =
    /\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;

  function clean(line: string): string {
    return line.replace(/<?\bhttps?:\/\/\S+>?/gi, "").trim();
  }
  function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }
  function isRule(line: string): boolean {
    return /^[\s─━—–\-_=~.·•*]{3,}$/u.test(line);
  }
  function isGrid(line: string): boolean {
    const body = line.replace(/\s*(?:=\s*)?[\d,.]+%?\s*$/, "").trim();
    return body.length > 0 && !/[\p{L}\p{N}]/u.test(body);
  }
  function isHeaderLike(line: string): boolean {
    const key = squash(title);
    if (key.length >= 3 && squash(line).indexOf(key) !== -1) return true;
    return /#\s?\d/.test(line) || /\bNo\.\s?\d/i.test(line) || DATE.test(line);
  }
  function isTokenRow(line: string): boolean {
    const parts = line.split(/\s+[·|•]\s+/);
    return (
      parts.length >= 3 &&
      parts.every((p) => {
        return p.length > 0 && p.length <= 24;
      })
    );
  }
  function isEmojiLed(line: string): boolean {
    return (
      /^[^\p{ASCII}\p{L}\p{N}\s]/u.test(line) &&
      /\p{L}/u.test(line) &&
      line.length <= 80 &&
      !/streak/i.test(line)
    );
  }
  function headerRemainder(line: string): string {
    let out = line;
    if (title) {
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "gi"), " ");
    }
    out = out
      .replace(/#\s?[\d,]+/g, " ")
      .replace(/\bNo\.\s?\d+/gi, " ")
      .replace(new RegExp(DATE.source, "gi"), " ")
      .replace(/\s{2,}/g, " ");
    return out.replace(/^[\s\-—–·|:,]+|[\s\-—–·|:,]+$/g, "");
  }

  const lines = raw
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => {
      return l.length > 0 && !/^#\S+$/.test(l) && !isRule(l);
    });
  if (lines.length === 0) return null;

  let firstGrid = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (isGrid(lines[i] as string)) {
      firstGrid = i;
      break;
    }
  }

  const kept: string[] = [];
  const numeric: string[] = [];
  let grids = 0;
  let headerScore = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (i < 2 && i < firstGrid && lines.length > 1 && isHeaderLike(line)) {
      if (scoreLine && line === scoreLine) headerScore = line;
      continue;
    }
    if (isGrid(line)) {
      grids += 1;
      kept.push(line);
    } else if ((scoreLine && line === scoreLine) || isTokenRow(line) || isEmojiLed(line)) {
      kept.push(line);
    } else if (!scoreLine && /\d/.test(line) && line.length <= 80) {
      // No parser to say where the score is: a short line with a number may be it.
      numeric.push(line);
    }
  }
  if (grids === 0 && numeric.length > 0) {
    // Back in reading order with what was kept.
    const order = new Map(lines.map((l, i) => [l, i]));
    kept.push(...numeric);
    kept.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  }
  if (headerScore && grids === 0) {
    const rest = headerRemainder(headerScore);
    if (rest) kept.push(rest);
  }
  if (kept.length === 2 && grids === 1) {
    const grid = kept.find(isGrid) as string;
    const other = kept.find((l) => {
      return l !== grid;
    }) as string;
    if (/^\d[\d,.:/]*$/.test(other)) return `${grid} ${other}`;
  }
  return kept.length ? kept.join("\n") : null;
}

/**
 * The first line of `raw` that shows `value` as written: plain (`415`),
 * grouped (`29,530`), decimal (`4.36`), or — for whole seconds — a clock
 * (`7:47`). Null when no line does (a grid-derived score, a loss). Like
 * `formatShareBodyHeuristic`, self-contained so it can be stored as code.
 */
export function findScoreLine(raw: string, value: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const forms: string[] = [];
  const plain = String(value);
  forms.push(plain);
  if (Number.isInteger(value) && Math.abs(value) >= 1000) {
    forms.push(plain.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  }
  if (Number.isInteger(value) && value >= 60) {
    const pad = (n: number) => {
      return n < 10 ? `0${n}` : String(n);
    };
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    forms.push(h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => {
      return l.replace(/<?\bhttps?:\/\/\S+>?/gi, "").trim();
    })
    .filter((l) => {
      return l.length > 0;
    });
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^\\d.,])${escaped}(?![\\d]|[.,]\\d)`);
    for (const line of lines) {
      if (re.test(line)) return line;
    }
  }
  return null;
}
