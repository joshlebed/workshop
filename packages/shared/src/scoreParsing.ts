// Score-spec DSL — the declarative parser that turns a pasted share text into
// a numeric score. Replaces the old per-game regex strings (and the `count:`
// sentinel hack they grew): a spec is plain JSON data, so it can live in code
// (the game registry), in the DB (`games.score_spec`, user-taught games), and
// run identically on the backend and in the client (paste-sheet previews).
//
// Pure runtime module exported via the `./scoreParsing` subpath (like
// `./constants` / `./games`): Metro can't resolve the barrel's `.js`
// re-exports, so the client imports this file directly.
//
// Design rules:
// - Deterministic and total: same (spec, raw) always yields the same value;
//   a malformed rule never throws, it just doesn't match.
// - A spec is a first-match-wins list of small primitives. New share shapes
//   should extend the *interpreter* with a primitive (reviewed code, benefits
//   every game), never reintroduce per-game code.

import { z } from "zod";
import type { GameScoreDirection } from "./games.js";

// ---------------------------------------------------------------------------
// Spec types
// ---------------------------------------------------------------------------

/** Regex capture: group 1 (or the whole match) read as a number, commas stripped. */
export interface CaptureRule {
  kind: "capture";
  /** JS regex source, applied with the `i` flag. */
  pattern: string;
}

/**
 * Count occurrences of a literal token (e.g. Daily Tens scores by 🏆 count).
 * `within` (a regex, `u` flag) guards against resultless shares: when set, the
 * rule only applies if `within` matches somewhere — so a URL-only Daily Tens
 * share (no grid at all) yields null instead of a fake 0, while an all-❌ grid
 * still scores a legitimate 0.
 */
export interface CountRule {
  kind: "count";
  token: string;
  within?: string | undefined;
}

/**
 * Count lines matching a regex (`u` flag, tested against each trimmed line).
 * Zero matching lines yields null, not 0 — "no grid" is "no result".
 * (Connections: guess rows are lines of exactly four color squares.)
 */
export interface CountLinesRule {
  kind: "countLines";
  pattern: string;
}

/**
 * Parse a `m:ss` (or `h:mm:ss`) time into total seconds (NYT Mini).
 * `pattern` overrides the default matcher; it must expose the minutes and
 * seconds (and optionally hours) as its last two/three capture groups.
 */
export interface DurationRule {
  kind: "duration";
  pattern?: string | undefined;
}

/**
 * 1-based position of the first `token` within the sequence of tokens drawn
 * from `among` ∪ {token}, reading the share left to right (Framed: the guess
 * count is the position of 🟩 among the colored squares). No `token` present
 * yields null — a loss has no numeric score, like Wordle's X/6.
 */
export interface TokenPositionRule {
  kind: "tokenPosition";
  token: string;
  among: string[];
}

/**
 * Capture a word/phrase (group 1) and map it through a lookup table,
 * case-insensitively (Spelling Bee ranks: "Genius" → 9).
 */
export interface WordMapRule {
  kind: "wordMap";
  pattern: string;
  map: Record<string, number>;
}

export type ScoreRule =
  | CaptureRule
  | CountRule
  | CountLinesRule
  | DurationRule
  | TokenPositionRule
  | WordMapRule;

/** First rule that yields a value wins. */
export interface ScoreSpec {
  rules: ScoreRule[];
}

// ---------------------------------------------------------------------------
// Validation (specs cross trust boundaries: user-taught specs land in jsonb)
// ---------------------------------------------------------------------------

const PATTERN_MAX = 200;

function compiles(pattern: string, flags: string): boolean {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

const patternSchema = z
  .string()
  .min(1)
  .max(PATTERN_MAX)
  .refine((p) => compiles(p, "iu"), "pattern must be a valid regular expression");

const tokenSchema = z.string().min(1).max(16);

const scoreRuleSchema: z.ZodType<ScoreRule> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capture"), pattern: patternSchema }).strict(),
  z
    .object({
      kind: z.literal("count"),
      token: tokenSchema,
      within: patternSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("countLines"), pattern: patternSchema }).strict(),
  z.object({ kind: z.literal("duration"), pattern: patternSchema.optional() }).strict(),
  z
    .object({
      kind: z.literal("tokenPosition"),
      token: tokenSchema,
      among: z.array(tokenSchema).min(1).max(16),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wordMap"),
      pattern: patternSchema,
      map: z
        .record(z.string().min(1).max(40), z.number().finite())
        .refine(
          (m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 32,
          "map must have 1–32 entries",
        ),
    })
    .strict(),
]);

export const scoreSpecSchema: z.ZodType<ScoreSpec> = z
  .object({ rules: z.array(scoreRuleSchema).min(1).max(8) })
  .strict();

/** Validate an untrusted value (jsonb column, API body) into a ScoreSpec. */
export function safeParseScoreSpec(value: unknown): ScoreSpec | null {
  const parsed = scoreSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

export interface SpecEvaluation {
  /** Parsed score, or null when no rule produced one. */
  value: number | null;
  /**
   * False when every rule was malformed (bad regex etc.) — callers treat that
   * like "no spec" and may fall back, instead of trusting a null that no rule
   * actually computed.
   */
  hadValidRule: boolean;
}

function toFiniteNumber(text: string): number | null {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function countOccurrences(haystack: string, token: string): number {
  if (token.length === 0) return 0;
  return haystack.split(token).length - 1;
}

const DEFAULT_DURATION_PATTERN = "(?:(\\d+):)?(\\d+):(\\d{2})";

function evaluateRule(rule: ScoreRule, raw: string): { value: number | null; valid: boolean } {
  switch (rule.kind) {
    case "capture": {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        return { value: null, valid: false };
      }
      const match = raw.match(re);
      if (!match) return { value: null, valid: true };
      return { value: toFiniteNumber(match[1] ?? match[0]), valid: true };
    }
    case "count": {
      if (rule.within !== undefined) {
        let guard: RegExp;
        try {
          guard = new RegExp(rule.within, "u");
        } catch {
          return { value: null, valid: false };
        }
        if (!guard.test(raw)) return { value: null, valid: true };
      }
      return { value: countOccurrences(raw, rule.token), valid: true };
    }
    case "countLines": {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "u");
      } catch {
        return { value: null, valid: false };
      }
      const n = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => re.test(l)).length;
      return { value: n > 0 ? n : null, valid: true };
    }
    case "duration": {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern ?? DEFAULT_DURATION_PATTERN);
      } catch {
        return { value: null, valid: false };
      }
      const match = raw.match(re);
      if (!match) return { value: null, valid: true };
      // Last two groups are minutes:seconds; an optional third-from-last is hours.
      const groups = match.slice(1).filter((g): g is string => g !== undefined);
      if (groups.length < 2) return { value: null, valid: true };
      const nums = groups.map((g) => Number(g));
      if (nums.some((n) => !Number.isFinite(n))) return { value: null, valid: true };
      const [s, m, h] = [...nums].reverse();
      const total = (s ?? 0) + (m ?? 0) * 60 + (h ?? 0) * 3600;
      return { value: total, valid: true };
    }
    case "tokenPosition": {
      const tokens = [rule.token, ...rule.among].filter((t) => t.length > 0);
      if (tokens.length === 0) return { value: null, valid: false };
      // Scan left to right for the earliest occurrence of any token, repeatedly.
      let position = 0;
      let cursor = 0;
      while (cursor < raw.length) {
        let earliest = -1;
        let earliestToken = "";
        for (const t of tokens) {
          const at = raw.indexOf(t, cursor);
          if (at !== -1 && (earliest === -1 || at < earliest)) {
            earliest = at;
            earliestToken = t;
          }
        }
        if (earliest === -1) break;
        position += 1;
        if (earliestToken === rule.token) return { value: position, valid: true };
        cursor = earliest + earliestToken.length;
      }
      return { value: null, valid: true };
    }
    case "wordMap": {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        return { value: null, valid: false };
      }
      const match = raw.match(re);
      const captured = match?.[1];
      if (!captured) return { value: null, valid: true };
      const key = captured.trim().toLowerCase().replace(/\s+/g, " ");
      for (const [k, v] of Object.entries(rule.map)) {
        if (k.trim().toLowerCase().replace(/\s+/g, " ") === key) {
          return { value: v, valid: true };
        }
      }
      return { value: null, valid: true };
    }
  }
}

/** Run a spec over a raw share text. First rule that yields a value wins. */
export function evaluateScoreSpec(spec: ScoreSpec, raw: string): SpecEvaluation {
  let hadValidRule = false;
  for (const rule of spec.rules) {
    const { value, valid } = evaluateRule(rule, raw);
    hadValidRule = hadValidRule || valid;
    if (value !== null) return { value, hadValidRule: true };
  }
  return { value: null, hadValidRule };
}

/** Sugar over `evaluateScoreSpec` for callers that don't need validity info. */
export function parseScoreWithSpec(spec: ScoreSpec, raw: string): number | null {
  return evaluateScoreSpec(spec, raw).value;
}

/** The legacy last-resort parse: first number anywhere in the text. */
export function parseFirstNumber(raw: string): number | null {
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Stored-rule strings (items.score_regex column) — three generations coexist:
//   "<regex source>"      capture group 1 (the original format)
//   "count:<pattern>"     count of global matches (the Daily Tens hack)
//   "spec:<json>"         a serialized ScoreSpec (current)
// ---------------------------------------------------------------------------

export const SCORE_COUNT_PREFIX = "count:";
export const SCORE_SPEC_PREFIX = "spec:";

/** Decode a stored rule string (any generation) into a spec. */
export function specFromStoredRule(stored: string | null | undefined): ScoreSpec | null {
  if (!stored || stored.length === 0) return null;
  if (stored.startsWith(SCORE_SPEC_PREFIX)) {
    try {
      return safeParseScoreSpec(JSON.parse(stored.slice(SCORE_SPEC_PREFIX.length)));
    } catch {
      return null;
    }
  }
  if (stored.startsWith(SCORE_COUNT_PREFIX)) {
    return { rules: [{ kind: "count", token: stored.slice(SCORE_COUNT_PREFIX.length) }] };
  }
  return { rules: [{ kind: "capture", pattern: stored }] };
}

/**
 * Encode a spec as a stored rule string, preferring the legacy formats when
 * the spec is expressible in them (older deployed parsers keep working
 * through a deploy window, and the strings stay human-readable in psql).
 */
export function storedRuleFromSpec(spec: ScoreSpec): string {
  const only = spec.rules.length === 1 ? spec.rules[0] : undefined;
  if (only?.kind === "capture") return only.pattern;
  if (only?.kind === "count" && only.within === undefined) {
    return `${SCORE_COUNT_PREFIX}${only.token}`;
  }
  return `${SCORE_SPEC_PREFIX}${JSON.stringify(spec)}`;
}

// ---------------------------------------------------------------------------
// Self-serve synthesis — turn "this share text + the score the user tapped"
// into a spec, deterministically. The authoring UI tokenizes the share into
// candidate scores; when the user picks one, `synthesizeScoreSpec` derives a
// spec and only returns it if re-running it on the example reproduces the
// chosen value. No regex knowledge required from the user.
// ---------------------------------------------------------------------------

export type ScoreCandidateKind = "duration" | "fraction" | "plus" | "number" | "emojiCount";

export interface ScoreCandidate {
  kind: ScoreCandidateKind;
  /** Verbatim slice of the share (for "number" kinds) or the emoji token. */
  text: string;
  /** Char offset in the raw share; emoji counts use the first occurrence. */
  start: number;
  /** What this candidate parses to. */
  value: number;
  /** Human label for the picker chip, e.g. "3/6 → 3" or "7 × 🏆". */
  label: string;
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

// Common result-grid emoji seen in daily-game shares. Single-codepoint (plus
// optional VS16) on purpose — Hermes lacks reliable Unicode property escapes,
// so we enumerate rather than match \p{Extended_Pictographic}.
const GRID_EMOJI = [
  "🏆",
  "❌",
  "✅",
  "✔️",
  "🟩",
  "🟨",
  "🟧",
  "🟥",
  "🟦",
  "🟪",
  "⬛",
  "⬜",
  "🟢",
  "🟡",
  "🔴",
  "🔵",
  "🟠",
  "🟣",
  "⭐",
  "🌟",
  "💡",
  "🔥",
  "🎯",
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Span {
  start: number;
  end: number;
}

function insideAny(spans: Span[], start: number, end: number): boolean {
  return spans.some((s) => start >= s.start && end <= s.end);
}

/**
 * Enumerate everything in a share text that could plausibly be the score.
 * URLs are excluded (referral ids and puzzle URLs are never scores).
 */
export function tokenizeScoreCandidates(raw: string): ScoreCandidate[] {
  const urlSpans: Span[] = [];
  for (const m of raw.matchAll(URL_RE)) {
    urlSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  const candidates: ScoreCandidate[] = [];
  const consumed: Span[] = [];

  const push = (c: ScoreCandidate, span: Span) => {
    if (insideAny(urlSpans, span.start, span.end)) return;
    candidates.push(c);
    consumed.push(span);
  };

  // Durations: 0:30, 12:05, 1:02:33
  for (const m of raw.matchAll(/\b(?:(\d+):)?(\d+):(\d{2})\b/g)) {
    const [h, min, s] = [m[1], m[2], m[3]];
    const value = (h ? Number(h) * 3600 : 0) + Number(min) * 60 + Number(s);
    push(
      {
        kind: "duration",
        text: m[0],
        start: m.index,
        value,
        label: `${m[0]} → ${value}s`,
      },
      { start: m.index, end: m.index + m[0].length },
    );
  }

  // Fractions: 3/6, 711 / 1,000 — value is the left side.
  for (const m of raw.matchAll(/(?<![\d,:.])([\d,]+)\s*\/\s*([\d,]+)\b/g)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (insideAny(consumed, span.start, span.end)) continue;
    const value = toFiniteNumber(m[1] ?? "");
    if (value === null) continue;
    push(
      { kind: "fraction", text: m[0], start: m.index, value, label: `${m[0]} → ${value}` },
      span,
    );
  }

  // Plus scores: +2 (travle-style "extra guesses")
  for (const m of raw.matchAll(/(?<![\d,])\+(\d+)\b/g)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (insideAny(consumed, span.start, span.end)) continue;
    const value = Number(m[1]);
    push({ kind: "plus", text: m[0], start: m.index, value, label: `${m[0]} → ${value}` }, span);
  }

  // Bare numbers not already part of a richer candidate.
  for (const m of raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (insideAny(consumed, span.start, span.end)) continue;
    const value = toFiniteNumber(m[0]);
    if (value === null) continue;
    push({ kind: "number", text: m[0], start: m.index, value, label: m[0] }, span);
  }

  // Emoji tallies — one candidate per distinct grid emoji present.
  const withoutUrls = raw.replace(URL_RE, "");
  for (const token of GRID_EMOJI) {
    const count = countOccurrences(withoutUrls, token);
    if (count === 0) continue;
    candidates.push({
      kind: "emojiCount",
      text: token,
      start: raw.indexOf(token),
      value: count,
      label: `${count} × ${token}`,
    });
  }

  return candidates.sort((a, b) => a.start - b.start);
}

function specIfReproduces(spec: ScoreSpec, raw: string, expected: number): ScoreSpec | null {
  return parseScoreWithSpec(spec, raw) === expected ? spec : null;
}

/** Non-space run immediately before `start` on the same line (anchor text). */
function precedingAnchor(raw: string, start: number): string | null {
  const lineStart = raw.lastIndexOf("\n", start - 1) + 1;
  const before = raw.slice(lineStart, start);
  const m = before.match(/(\S{1,24})\s*$/);
  return m?.[1] ?? null;
}

function followingAnchor(raw: string, end: number): string | null {
  const lineEnd = raw.indexOf("\n", end);
  const after = raw.slice(end, lineEnd === -1 ? raw.length : lineEnd);
  const m = after.match(/^\s*(\S{1,24})/);
  return m?.[1] ?? null;
}

/**
 * Derive a spec from an example share + the candidate the user tapped.
 * Returns null when no deterministic rule reproduces the choice — callers
 * fall back to posting unparsed (or a smarter synthesizer).
 */
export function synthesizeScoreSpec(raw: string, candidate: ScoreCandidate): ScoreSpec | null {
  const expected = candidate.value;

  if (candidate.kind === "emojiCount") {
    const withoutUrls = raw.replace(URL_RE, "");
    const present = GRID_EMOJI.filter((t) => withoutUrls.includes(t));
    const within = present.length > 0 ? `[${present.map(escapeRegExp).join("")}]` : undefined;
    const spec: ScoreSpec = {
      rules: [
        within === undefined
          ? { kind: "count", token: candidate.text }
          : { kind: "count", token: candidate.text, within },
      ],
    };
    return specIfReproduces(spec, raw, expected);
  }

  if (candidate.kind === "duration") {
    const bare = specIfReproduces({ rules: [{ kind: "duration" }] }, raw, expected);
    if (bare) return bare;
    // Multiple times in the share — anchor on the preceding word.
    const anchor = precedingAnchor(raw, candidate.start);
    if (anchor) {
      return specIfReproduces(
        {
          rules: [
            { kind: "duration", pattern: `${escapeRegExp(anchor)}\\s*(?:(\\d+):)?(\\d+):(\\d{2})` },
          ],
        },
        raw,
        expected,
      );
    }
    return null;
  }

  if (candidate.kind === "fraction") {
    const right = candidate.text.split("/")[1]?.trim() ?? "";
    // "3/6" style: the denominator is a constant scale — anchor on it.
    const denomAnchored = specIfReproduces(
      { rules: [{ kind: "capture", pattern: `([\\d,]+)\\s*\\/\\s*${escapeRegExp(right)}\\b` }] },
      raw,
      expected,
    );
    if (denomAnchored) return denomAnchored;
    // Variable denominator: any fraction, first one wins.
    return specIfReproduces(
      { rules: [{ kind: "capture", pattern: "([\\d,]+)\\s*\\/\\s*[\\d,]+" }] },
      raw,
      expected,
    );
  }

  if (candidate.kind === "plus") {
    return specIfReproduces(
      { rules: [{ kind: "capture", pattern: "\\+(\\d+)\\b" }] },
      raw,
      expected,
    );
  }

  // Bare number: try an anchored capture (preceding token, then following),
  // then "first number in the share".
  const attempts: string[] = [];
  const before = precedingAnchor(raw, candidate.start);
  if (before) attempts.push(`${escapeRegExp(before)}\\s*([\\d,]+(?:\\.\\d+)?)`);
  const after = followingAnchor(raw, candidate.start + candidate.text.length);
  if (after) attempts.push(`([\\d,]+(?:\\.\\d+)?)\\s*${escapeRegExp(after)}`);
  attempts.push("([\\d,]+(?:\\.\\d+)?)");
  for (const pattern of attempts) {
    const spec = specIfReproduces({ rules: [{ kind: "capture", pattern }] }, raw, expected);
    if (spec) return spec;
  }
  return null;
}

/**
 * Sensible default for "is lower better?" by candidate shape — always
 * confirmed by the user in the teach flow, never silently trusted.
 */
export function suggestScoreDirection(candidate: ScoreCandidate): GameScoreDirection {
  switch (candidate.kind) {
    case "duration":
      return "asc"; // solve times: faster is better
    case "plus":
      return "asc"; // "+N extra guesses": fewer is better
    case "fraction":
      return "asc"; // "3/6 guesses": fewer is better
    default:
      return "desc"; // points / tallies: more is better
  }
}
