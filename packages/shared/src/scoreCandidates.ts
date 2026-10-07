// Score candidates ("teach v2") — everything in a pasted share that could be
// the score, computed deterministically from the text. A candidate is a
// *feature*: a literal number, a symbol count scoped to the result grid, a
// grid row count, the position of a marker symbol, or a duration.
//
// The server is the authority: a pick names a feature by `id`, and the server
// recomputes the features from the stored text and reads the value itself, so
// a client can never supply a value that was not computed from the text. The
// client runs the same function for the instant chips shown before (or
// without) the LLM's role labels.
//
// Pure runtime module exported via the `./scoreCandidates` subpath, with no
// value imports from its siblings: Metro cannot resolve the `.js` specifiers
// shared modules use for each other, so a client bundle that imports this file
// must find everything it needs inside it. That is also why the literal-number
// pass below is its own copy rather than a call into `tokenizeScoreCandidates`
// (`./scoreParsing`) — which the frozen Workshop `legacyGames` snapshot still
// calls, and which must keep its behaviour.

import type { GameScoreDirection } from "./games.js";

export type ScoreFeatureKind =
  | "number"
  | "fraction"
  | "plus"
  | "duration"
  | "symbolCount"
  | "rowCount"
  | "position";

export interface ScoreFeature {
  /**
   * Stable for a given text: `number@12`, `count:🏆`, `rows`, `pos:🟩`. The
   * same text always yields the same ids, on the client and on the server.
   */
  id: string;
  kind: ScoreFeatureKind;
  value: number;
  /** Chip label: `944`, `3/6 → 3`, `0:42 → 42s`, `7 × 🏆`, `6 rows`, `🟩 is 4th`. */
  label: string;
  /** How a computed value was derived (`counted 🏆`); null for a literal number. */
  derivation: string | null;
  /** Literal kinds: the verbatim slice and its offset in the text. */
  text: string | null;
  start: number | null;
  /** Symbol kinds: the symbol, variation selector stripped. */
  symbol: string | null;
}

/** What the "find targets" step says a candidate is. */
export const SCORE_FEATURE_ROLES = [
  "score",
  "puzzle_number",
  "date",
  "streak",
  "percentile",
  "other",
] as const;
export type ScoreFeatureRole = (typeof SCORE_FEATURE_ROLES)[number];

/** A user's choice in the candidate picker. */
export type ScorePick = { kind: "feature"; featureId: string } | { kind: "no_result" };

/** At most this many candidates are offered; literal numbers come first. */
export const MAX_SCORE_FEATURES = 24;
const MAX_SYMBOL_COUNT_FEATURES = 8;
/** Above this many distinct grid symbols (a row of flags), only repeats are tallied. */
const MAX_DISTINCT_FOR_SINGLETONS = 6;

const URL_RE = /\bhttps?:\/\/\S+/gi;

// One emoji / symbol as a person sees it: a flag (two regional indicators), a
// keycap, or a pictograph with its variation selector, skin tone and any
// ZWJ-joined parts. Box-drawing blocks and geometric shapes are included
// because text-only grids use them (■ □ ▪).
const SYMBOL_SOURCE =
  "(?:\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F?\\u20E3|(?:\\p{Extended_Pictographic}|[\\u2580-\\u259F\\u25A0-\\u25FF])(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*)";

function symbolRegExp(): RegExp {
  return new RegExp(SYMBOL_SOURCE, "gu");
}

/** `⚪️` and `⚪` are one symbol: drop the variation selector. */
function symbolKey(cluster: string): string {
  return cluster.replace(/️/g, "");
}

/** The symbols in a piece of text, in reading order, variation selectors stripped. */
export function symbolsIn(text: string): string[] {
  return (text.match(symbolRegExp()) ?? []).map(symbolKey);
}

interface Span {
  start: number;
  end: number;
}

function inside(spans: readonly Span[], span: Span): boolean {
  return spans.some((s) => span.start >= s.start && span.end <= s.end);
}

function toFiniteNumber(text: string): number | null {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function literal(
  kind: ScoreFeatureKind,
  text: string,
  start: number,
  value: number,
  label: string,
): ScoreFeature {
  return {
    id: `${kind}@${start}`,
    kind,
    value,
    label,
    derivation: null,
    text,
    start,
    symbol: null,
  };
}

/**
 * The literal numbers in a share, richest reading first: a time (`0:42` → 42
 * seconds), a fraction (`3/6` → 3), a plus score (`+2`), then any bare number
 * not already part of one of those. Nothing inside a URL counts.
 */
function literalFeatures(raw: string): ScoreFeature[] {
  const urls: Span[] = [...raw.matchAll(URL_RE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const features: ScoreFeature[] = [];
  const consumed: Span[] = [];
  const push = (feature: ScoreFeature, span: Span) => {
    if (inside(urls, span) || inside(consumed, span)) return;
    features.push(feature);
    consumed.push(span);
  };
  const spanOf = (m: RegExpMatchArray): Span => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  });

  for (const m of raw.matchAll(/\b(?:(\d+):)?(\d+):(\d{2})\b/g)) {
    const value = (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
    push(literal("duration", m[0], m.index, value, `${m[0]} → ${value}s`), spanOf(m));
  }
  for (const m of raw.matchAll(/(?<![\d,:.])([\d,]+)\s*\/\s*([\d,]+)\b/g)) {
    const value = toFiniteNumber(m[1] ?? "");
    if (value === null) continue;
    push(literal("fraction", m[0], m.index, value, `${m[0]} → ${value}`), spanOf(m));
  }
  for (const m of raw.matchAll(/(?<![\d,])\+(\d+)\b/g)) {
    const value = Number(m[1]);
    push(literal("plus", m[0], m.index, value, `${m[0]} → ${value}`), spanOf(m));
  }
  for (const m of raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = toFiniteNumber(m[0]);
    if (value === null) continue;
    push(literal("number", m[0], m.index, value, m[0]), spanOf(m));
  }
  return features.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

export interface SymbolSpan {
  /** Offsets into the text the spans were read from. */
  start: number;
  end: number;
  /** The symbol, variation selector stripped (`text.slice(start, end)` is as written). */
  symbol: string;
}

/** Where each symbol sits in a piece of text, in reading order. */
export function symbolSpans(text: string): SymbolSpan[] {
  return [...text.matchAll(symbolRegExp())].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    symbol: symbolKey(m[0]),
  }));
}

export interface GridLine {
  /** Offset of the line's first character in the raw text. */
  start: number;
  /** The line as written (not trimmed). */
  text: string;
  symbols: string[];
}

/**
 * The result grid: every line made of symbols and whitespace only. A line
 * that mixes symbols with words (`🏆 crushed it`, `Krillion #81 🦐`) is prose,
 * not grid, so a hand-typed note never changes a count.
 */
export function gridLines(raw: string): GridLine[] {
  const lines: GridLine[] = [];
  let offset = 0;
  for (const line of raw.split("\n")) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    const symbols = symbolsIn(text);
    if (symbols.length > 0 && text.replace(symbolRegExp(), "").trim().length === 0) {
      lines.push({ start: offset, text, symbols });
    }
    offset += line.length + 1;
  }
  return lines;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function tally(symbols: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const symbol of symbols) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  return counts;
}

function countFeature(symbol: string, count: number): ScoreFeature {
  return {
    id: `count:${symbol}`,
    kind: "symbolCount",
    value: count,
    label: `${count} × ${symbol}`,
    derivation: `counted ${symbol}`,
    text: null,
    start: null,
    symbol,
  };
}

export interface ScoreFeatureOptions {
  /**
   * Symbols this game's score has been counted from before. Offered as a
   * `0 × 🏆` candidate when the grid has none of them — an all-❌ Daily Tens
   * grid is a score of 0, not a loss.
   */
  knownSymbols?: readonly string[] | undefined;
}

/**
 * Every feature of a share text that could be its score. Deterministic and
 * total: the same text always gives the same list, and nothing here throws.
 * URLs are ignored (referral ids are never scores).
 */
export function computeScoreFeatures(
  raw: string,
  options: ScoreFeatureOptions = {},
): ScoreFeature[] {
  const literals = literalFeatures(raw);

  const grid = gridLines(raw);
  const computed: ScoreFeature[] = [];
  if (grid.length > 0) {
    const sequence = grid.flatMap((line) => line.symbols);
    const counts = tally(sequence);
    const offerSingletons = counts.size <= MAX_DISTINCT_FOR_SINGLETONS;
    const tallied = [...counts.entries()]
      .filter(([, count]) => offerSingletons || count >= 2)
      .slice(0, MAX_SYMBOL_COUNT_FEATURES);
    for (const [symbol, count] of tallied) computed.push(countFeature(symbol, count));
    for (const symbol of options.knownSymbols ?? []) {
      const key = symbolKey(symbol);
      if (!counts.has(key)) computed.push(countFeature(key, 0));
    }
    if (grid.length >= 2) {
      computed.push({
        id: "rows",
        kind: "rowCount",
        value: grid.length,
        label: `${grid.length} rows`,
        derivation: "counted rows",
        text: null,
        start: null,
        symbol: null,
      });
    }
    // A marker's position only means something in a one-line grid (Satle,
    // Framed): which guess turned green.
    if (grid.length === 1 && sequence.length >= 2 && offerSingletons) {
      for (const [symbol, count] of counts) {
        if (count !== 1) continue;
        const position = sequence.indexOf(symbol) + 1;
        computed.push({
          id: `pos:${symbol}`,
          kind: "position",
          value: position,
          label: `${symbol} is ${ordinal(position)}`,
          derivation: `position of ${symbol}`,
          text: null,
          start: null,
          symbol,
        });
      }
    }
  } else {
    // No grid at all: tally symbols that repeat anywhere outside URLs.
    const counts = tally(symbolsIn(raw.replace(URL_RE, "")));
    const repeated = [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .slice(0, MAX_SYMBOL_COUNT_FEATURES);
    for (const [symbol, count] of repeated) computed.push(countFeature(symbol, count));
  }

  return [...literals, ...computed].slice(0, MAX_SCORE_FEATURES);
}

/** The feature a pick names in this text, or null when the text has no such feature. */
export function findScoreFeature(
  raw: string,
  featureId: string,
  options: ScoreFeatureOptions = {},
): ScoreFeature | null {
  return computeScoreFeatures(raw, options).find((f) => f.id === featureId) ?? null;
}

/**
 * Default for "is lower better?" by feature kind — always confirmed by the
 * user on a first teach, never silently trusted.
 */
export function suggestDirectionForFeature(
  feature: Pick<ScoreFeature, "kind">,
): GameScoreDirection {
  switch (feature.kind) {
    case "duration": // solve times
    case "plus": // "+N extra guesses"
    case "fraction": // "3/6 guesses"
    case "rowCount": // one row per guess
    case "position": // which guess turned green
      return "asc";
    default:
      return "desc"; // points and tallies
  }
}

/**
 * The derivation to show beside a value the parser read ("Score: 7 (counted
 * 🏆)"). A value that also appears as a literal number needs no explanation;
 * otherwise the computed feature with that value explains it. Null when the
 * text offers no such feature.
 */
export function derivationForValue(raw: string, value: number): string | null {
  const features = computeScoreFeatures(raw);
  if (features.some((f) => f.derivation === null && f.value === value)) return null;
  return features.find((f) => f.derivation !== null && f.value === value)?.derivation ?? null;
}
