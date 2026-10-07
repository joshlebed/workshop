// What a game's stored code makes of one share text: the three things a
// `game_scores` row records (status, value, summary). The one place that
// turns sandbox results into stored values, so the write path, the operator
// script and the comparison script cannot disagree.

import { formatShareBodyFallback } from "@workshop/shared/gameRegistry";
import { KILLED_DETAIL, runFormat, runParse } from "./runtime.js";
import type { FormatResult, ParseResult } from "./types.js";

export type ParseStatus = "score" | "no_result" | "failed";

export function isParseStatus(value: unknown): value is ParseStatus {
  return value === "score" || value === "no_result" || value === "failed";
}

export interface GameCode {
  parseCode: string | null;
  formatCode: string | null;
}

export interface CodeScore {
  parseStatus: ParseStatus;
  /** Set only when `parseStatus` is `score`. */
  scoreValue: number | null;
  /**
   * The row's display text: `format`'s output, else the cleaned raw text.
   * Null only when even that is empty (a URL-only share).
   */
  scoreSummary: string | null;
  /** The raw sandbox results, for logs and diagnostics. */
  parse: ParseResult;
  /** Null when the game has no format code or the run was skipped. */
  format: FormatResult | null;
}

const NO_CODE: ParseResult = { kind: "failed", reason: "no_code" };

function statusOf(parse: ParseResult): ParseStatus {
  if (parse.kind === "score") return "score";
  return parse.kind === "noResult" ? "no_result" : "failed";
}

/** A parse that ended with the sandbox dead or unreachable — don't queue more work behind it. */
function sandboxIsStruggling(parse: ParseResult): boolean {
  return (
    parse.kind === "failed" &&
    (parse.reason === "sandbox_unavailable" || parse.detail === KILLED_DETAIL)
  );
}

/**
 * Run a game's code over one share. Never throws. A game with no parse code
 * is `failed` (reason `no_code`) — there is deliberately no "first number in
 * the text" guess. Bounded: each run is capped by the sandbox, and `format`
 * is skipped when `parse` just took the sandbox down, so the worst case is
 * one worker start plus two wall-clock budgets.
 */
export async function scoreWithGameCode(code: GameCode, raw: string): Promise<CodeScore> {
  const parse = code.parseCode === null ? NO_CODE : await runParse(code.parseCode, raw);
  const format =
    code.formatCode === null || sandboxIsStruggling(parse)
      ? null
      : await runFormat(code.formatCode, raw);
  return {
    parseStatus: statusOf(parse),
    scoreValue: parse.kind === "score" ? parse.value : null,
    scoreSummary: format?.kind === "summary" ? format.text : formatShareBodyFallback(raw),
    parse,
    format,
  };
}

/**
 * How the stored code's reading of a share relates to the legacy parser's.
 * Shared by the shadow log and scripts/compare-game-code.ts so "disagree"
 * means the same thing in both.
 */
export const PARSE_CHANGES = [
  "same_score",
  "null_to_no_result",
  "null_to_failed",
  "null_to_score",
  "score_to_failed",
  "score_to_no_result",
  "score_changed",
] as const;
export type ParseChange = (typeof PARSE_CHANGES)[number];

export function classifyParseChange(
  legacyValue: number | null,
  parseStatus: ParseStatus,
  scoreValue: number | null,
): ParseChange {
  if (legacyValue === null) {
    if (parseStatus === "score") return "null_to_score";
    return parseStatus === "no_result" ? "null_to_no_result" : "null_to_failed";
  }
  if (parseStatus === "failed") return "score_to_failed";
  if (parseStatus === "no_result") return "score_to_no_result";
  return scoreValue === legacyValue ? "same_score" : "score_changed";
}

/** Old and new agree when both read the same number or neither reads one. */
export function parseChangeAgrees(change: ParseChange): boolean {
  return change === "same_score" || change === "null_to_no_result" || change === "null_to_failed";
}
