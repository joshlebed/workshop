// Summary-spec DSL — the declarative display-side twin of the score-spec
// parser (`./scoreParsing`). A ScoreSpec turns a pasted share into a number;
// a SummarySpec turns the same share into the compact block leaderboard rows
// and clipboard recaps show. Registry games get hand-written `formatShareBody`
// formatters in `./gameRegistry`; user-taught games get one of these instead,
// synthesized in the teach flow from the lines the user chose to keep and
// stored on the catalog row (`games.summary_spec` jsonb).
//
// Pure runtime module exported via the `./summarySpec` subpath (like
// `./constants` / `./scoreParsing`): Metro can't resolve the barrel's `.js`
// re-exports, so the client imports this file directly.
//
// Design rules (same as the score-spec DSL):
// - Deterministic and total: same (spec, raw) always yields the same output;
//   a malformed rule never throws, it just doesn't match.
// - A spec that matches nothing yields null, and callers fall back to
//   `formatShareBodyFallback` — a stale spec degrades to the full text, never
//   to a blank row.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Spec types
// ---------------------------------------------------------------------------

/**
 * Keep the share lines whose trimmed text matches `pattern` (`u` flag).
 * Lines are the URL-stripped, non-blank, non-hashtag lines of the share —
 * the same line model as `formatShareBodyFallback`, so "no spec" and
 * "spec matching every line" render identically.
 */
export interface MatchLinesRule {
  kind: "matchLines";
  pattern: string;
}

export type SummaryRule = MatchLinesRule;

/** A line is kept when ANY rule matches it; output preserves share order. */
export interface SummarySpec {
  rules: SummaryRule[];
}

// ---------------------------------------------------------------------------
// Validation (specs cross trust boundaries: user-taught specs land in jsonb)
// ---------------------------------------------------------------------------

const PATTERN_MAX = 200;
const MAX_RULES = 12;

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
  .refine((p) => compiles(p, "u"), "pattern must be a valid regular expression");

export const summarySpecSchema: z.ZodType<SummarySpec> = z
  .object({
    rules: z
      .array(z.object({ kind: z.literal("matchLines"), pattern: patternSchema }).strict())
      .min(1)
      .max(MAX_RULES),
  })
  .strict();

/** Validate an untrusted value (jsonb column, API body) into a SummarySpec. */
export function safeParseSummarySpec(value: unknown): SummarySpec | null {
  const parsed = summarySpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Line model
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/\S+/gi;

/** One displayable line of a share, with its index into `summaryShareLines`. */
export interface SummaryLine {
  /** Raw line number in the original share (stable across re-tokenizing). */
  index: number;
  /** URL-stripped, trailing-trimmed text. Leading spaces kept (grid align). */
  text: string;
}

/**
 * The lines a summary can be built from: URLs stripped, blank and
 * pure-hashtag lines dropped. Mirrors `formatShareBodyFallback`'s strip rules
 * so selecting every line reproduces the fallback exactly.
 */
export function summaryShareLines(raw: string): SummaryLine[] {
  return raw
    .split(/\r?\n/)
    .map((l, index) => ({ index, text: l.replace(URL_RE, "").trimEnd() }))
    .filter((l) => l.text.trim().length > 0)
    .filter((l) => !/^\s*#\S+\s*$/.test(l.text));
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

/**
 * Run a spec over a raw share text: keep the lines any rule matches, in share
 * order. Null when nothing matches (or every rule is malformed) — callers
 * fall back to `formatShareBodyFallback`.
 */
export function evaluateSummarySpec(spec: SummarySpec, raw: string): string | null {
  const regexes: RegExp[] = [];
  for (const rule of spec.rules) {
    try {
      regexes.push(new RegExp(rule.pattern, "u"));
    } catch {
      // Malformed rule: skip it, like the score-spec interpreter.
    }
  }
  if (regexes.length === 0) return null;
  const kept = summaryShareLines(raw).filter((l) => regexes.some((re) => re.test(l.text.trim())));
  return kept.length > 0 ? kept.map((l) => l.text).join("\n") : null;
}

// ---------------------------------------------------------------------------
// Self-serve synthesis — turn "this share text + the lines the user kept"
// into a spec, deterministically. Mirrors `synthesizeScoreSpec`: derive the
// simplest rules, then only return them if re-running them on the example
// reproduces the user's exact selection.
// ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Any line with no ASCII letters — emoji grids, keycap times, `= N` tails. */
const LETTERLESS_PATTERN = "^[^A-Za-z]+$";

function isLetterless(text: string): boolean {
  return !/[A-Za-z]/.test(text);
}

/**
 * Generalize one trimmed line into a pattern that survives day-to-day churn:
 * digit runs (scores, puzzle numbers, dates, times) become a numeric class,
 * whitespace runs flex, everything else stays literal. `generalizeLetterless`
 * additionally collapses letter-free lines (emoji grids vary per day) into
 * the structural LETTERLESS_PATTERN.
 */
function generalizeLine(text: string, opts: { generalizeLetterless: boolean }): string | null {
  if (opts.generalizeLetterless && isLetterless(text)) return LETTERLESS_PATTERN;
  const parts: string[] = [];
  for (const m of text.matchAll(/(\d[\d,.:]*)|(\s+)|([^\d\s]+)/gu)) {
    if (m[1] !== undefined) parts.push("\\d[\\d,.:]*");
    else if (m[2] !== undefined) parts.push("\\s+");
    else parts.push(escapeRegExp(m[3] ?? ""));
  }
  const pattern = `^${parts.join("")}$`;
  if (pattern.length > PATTERN_MAX || !compiles(pattern, "u")) return null;
  return pattern;
}

function specFromSelection(
  lines: SummaryLine[],
  selected: ReadonlySet<number>,
  opts: { generalizeLetterless: boolean },
): SummarySpec | null {
  const patterns = new Set<string>();
  for (const line of lines) {
    if (!selected.has(line.index)) continue;
    const pattern = generalizeLine(line.text.trim(), opts);
    if (pattern === null) return null;
    patterns.add(pattern);
  }
  if (patterns.size === 0 || patterns.size > MAX_RULES) return null;
  return { rules: [...patterns].map((pattern) => ({ kind: "matchLines", pattern }) as const) };
}

function reproducesSelection(
  spec: SummarySpec,
  raw: string,
  lines: SummaryLine[],
  selected: ReadonlySet<number>,
): boolean {
  const expected = lines
    .filter((l) => selected.has(l.index))
    .map((l) => l.text)
    .join("\n");
  return evaluateSummarySpec(spec, raw) === expected;
}

/**
 * Derive a spec from an example share + the set of line indexes (into the
 * original share) the user kept. Tries the structural form first (letterless
 * lines matched as a class, so variable-height grids keep working), then a
 * fully line-anchored form. Returns null when neither reproduces the exact
 * selection — callers store no summary spec and the fallback text stands.
 */
export function synthesizeSummarySpec(
  raw: string,
  selectedIndexes: ReadonlyArray<number>,
): SummarySpec | null {
  const lines = summaryShareLines(raw);
  const selected = new Set(selectedIndexes);
  if (selected.size === 0) return null;
  // Selecting everything is the fallback rendering — no spec needed, and a
  // pattern-free future share shape stays unconstrained.
  if (lines.every((l) => selected.has(l.index))) return null;
  for (const generalizeLetterless of [true, false]) {
    const spec = specFromSelection(lines, selected, { generalizeLetterless });
    if (spec && reproducesSelection(spec, raw, lines, selected)) return spec;
  }
  return null;
}

/**
 * Default line selection for the teach flow's recap preview: keep the visual
 * grid lines (letterless) and the line the tapped score lives on; drop
 * headers/branding. When that heuristic keeps nothing, keep everything —
 * the user trims from a full preview rather than building up from blank.
 */
export function suggestSummaryLineIndexes(raw: string, scoreOffset?: number): number[] {
  const lines = summaryShareLines(raw);
  let scoreLineIndex: number | null = null;
  if (scoreOffset !== undefined && scoreOffset >= 0 && scoreOffset <= raw.length) {
    scoreLineIndex = raw.slice(0, scoreOffset).split(/\r?\n/).length - 1;
  }
  const picked = lines.filter((l) => l.index === scoreLineIndex || isLetterless(l.text.trim()));
  return (picked.length > 0 ? picked : lines).map((l) => l.index);
}
