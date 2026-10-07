// The flag-gated bridge between the score routes and the game-code sandbox
// (lib/gameCode): which parser is authoritative for a user, what a posted
// score stores, and the shadow log that compares the two parsers.

import { formatShareBodyFallback } from "@workshop/shared/gameRegistry";
import type { GameScorePreview, ScoreCodeFields } from "@workshop/shared/games";
import { evaluateScoreSpec } from "@workshop/shared/scoreParsing";
import type { DbGame } from "../db/schema.js";
import { getConfig } from "./config.js";
import { parseScoreValue, specForGame } from "./gameCatalog.js";
import { warmGameCodeSandbox } from "./gameCode/runtime.js";
import {
  type CodeScore,
  classifyParseChange,
  isParseStatus,
  type ParseStatus,
  parseChangeAgrees,
  scoreWithGameCode,
} from "./gameCode/scoring.js";
import { isGamesBetaUser } from "./gamesBeta.js";
import { logger } from "./logger.js";

/**
 * The code-parsing mode in force for one user: `on` for Games beta accounts,
 * otherwise whatever `GAME_CODE_PARSING` says. Every gate goes through this
 * (same shape as `recognitionModeFor`). Pass the user the session acts as.
 */
export function codeParsingModeFor(userId: string): "off" | "shadow" | "on" {
  return isGamesBetaUser(userId) ? "on" : getConfig().gameCodeParsing;
}

/**
 * The most a score post (or a preview) will wait for the sandbox. Each run is
 * already bounded on its own — 250 ms of wall clock, and a worker start of at
 * most 2 s on a cold container — so this cap should never be what ends the
 * wait. It is here so that "never" is enforced in one obvious place.
 */
export const GAME_CODE_BUDGET_MS = 1500;

type GameCodeColumns = Pick<DbGame, "parseCode" | "formatCode">;

interface BudgetedScore extends CodeScore {
  /** True when the budget ran out and the result is the fail-soft stand-in. */
  capped: boolean;
  durationMs: number;
}

/**
 * Run a game's stored code over one share, inside `GAME_CODE_BUDGET_MS`.
 * Never throws and never takes longer than the budget: past it, the share is
 * `failed` with the cleaned raw text as its summary — exactly what an
 * unreadable share stores.
 */
export async function scoreShareWithinBudget(
  game: GameCodeColumns,
  raw: string,
  budgetMs = GAME_CODE_BUDGET_MS,
): Promise<BudgetedScore> {
  const startedAt = Date.now();
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<null>((resolve) => {
    capTimer = setTimeout(() => resolve(null), budgetMs);
  });
  const scored = await Promise.race([
    scoreWithGameCode({ parseCode: game.parseCode, formatCode: game.formatCode }, raw).catch(
      (error: unknown) => {
        // scoreWithGameCode does not reject; this is for the bug that makes it.
        logger.error("game code scoring threw", { error });
        return null;
      },
    ),
    capped,
  ]);
  clearTimeout(capTimer);
  const durationMs = Date.now() - startedAt;
  if (scored) return { ...scored, capped: false, durationMs };
  return {
    parseStatus: "failed",
    scoreValue: null,
    scoreSummary: formatShareBodyFallback(raw),
    parse: { kind: "failed", reason: "sandbox_unavailable", detail: "over budget" },
    format: null,
    capped: true,
    durationMs,
  };
}

/** What the score upsert writes for one post. */
interface PostedScoreColumns {
  scoreValue: number | null;
  /** NULL unless stored code was authoritative for this post. */
  parseStatus: ParseStatus | null;
  scoreSummary: string | null;
  /** `parsed` when stored code read the row; NULL on legacy-shaped rows. */
  scoreSource: "parsed" | null;
  /**
   * The game's code version when stored code read the row; 0 when code
   * parsing was on but the sandbox was unavailable and the legacy spec's
   * reading was kept instead; NULL when code parsing was not in play.
   */
  codeVersion: number | null;
}

/**
 * What the game's legacy SPEC (registry or taught) reads from a share — and
 * only the spec: `undefined` when the game has none (or its rules are all
 * malformed). Unlike `parseScoreValue`, this never falls back to the first
 * number in the text; that guess must not reach a row written with code
 * parsing on.
 */
function legacySpecReading(game: DbGame, scoreRaw: string): number | null | undefined {
  const spec = specForGame(game);
  if (!spec) return undefined;
  const result = evaluateScoreSpec(spec, scoreRaw);
  return result.hadValidRule ? result.value : undefined;
}

/**
 * True when the stored code never got to give a verdict: the sandbox could
 * not run it, or did not answer inside the budget. A verdict the code DID
 * give — it threw, ran out of budget, returned junk — is not this.
 */
function sandboxFailedToAnswer(scored: BudgetedScore): boolean {
  return (
    scored.capped ||
    (scored.parse.kind === "failed" && scored.parse.reason === "sandbox_unavailable")
  );
}

/**
 * Decide what a posted score stores.
 *
 * - `off`: the legacy parser's value, and nothing else runs.
 * - `shadow`: the same stored values as `off`; the game's code also runs and
 *   one `kind: "game_code_shadow"` line records how it compares.
 * - `on`: the stored code is authoritative — its status, value and summary
 *   are stored (the legacy parser still runs, for the same log line).
 *
 * One exception under `on`: if the SANDBOX failed (unavailable, or over
 * budget) rather than the code, a good reading is not thrown away. A game
 * with a legacy spec keeps that spec's value, stored as a legacy-shaped row
 * (`code_version` 0, no status) and logged as `game_code_unavailable`; a game
 * with no legacy spec is stored unread. Failures of the code itself always
 * store `failed`.
 *
 * Never throws for anything the stored code does, and waits at most
 * `GAME_CODE_BUDGET_MS` for it. The raw text never goes to the logs.
 */
export async function resolvePostedScore(input: {
  userId: string;
  game: DbGame;
  periodKey: string;
  scoreRaw: string;
  /**
   * The sandbox's reading of this exact text, when the caller already has it
   * (the teach write path): used instead of running the code again.
   */
  scored?: BudgetedScore;
}): Promise<PostedScoreColumns> {
  const { game, scoreRaw } = input;
  const legacyValue = parseScoreValue(scoreRaw, specForGame(game));
  const legacy: PostedScoreColumns = {
    scoreValue: legacyValue,
    parseStatus: null,
    scoreSummary: null,
    scoreSource: null,
    codeVersion: null,
  };
  const mode = codeParsingModeFor(input.userId);
  if (mode === "off") return legacy;

  const scored = input.scored ?? (await scoreShareWithinBudget(game, scoreRaw));
  const change = classifyParseChange(legacyValue, scored.parseStatus, scored.scoreValue);
  const common = {
    mode,
    user_id: input.userId,
    game_id: game.id,
    game_key: game.gameKey,
    period_key: input.periodKey,
    code_version: game.codeVersion,
    capped: scored.capped,
    duration_ms: scored.durationMs,
    raw_length: scoreRaw.length,
  };
  const log = parseChangeAgrees(change) && !scored.capped ? logger.info : logger.warn;
  log("game code shadow", {
    kind: "game_code_shadow",
    ...common,
    legacy_value: legacyValue,
    code_status: scored.parseStatus,
    code_value: scored.scoreValue,
    outcome: parseChangeAgrees(change) ? "agree" : "disagree",
    change,
    // The reason only: a thrown message can quote the share text.
    failure_reason: scored.parse.kind === "failed" ? scored.parse.reason : null,
    format: scored.format?.kind ?? "absent",
    format_failure_reason: scored.format?.kind === "failed" ? scored.format.reason : null,
  });
  if (mode === "shadow") return legacy;

  if (sandboxFailedToAnswer(scored)) {
    const specValue = legacySpecReading(game, scoreRaw);
    // Its own event, at error level: this is the sandbox being down for a
    // live post, not a parser disagreeing.
    logger.error("game code unavailable for a score post", {
      kind: "game_code_unavailable",
      ...common,
      failure_reason: scored.capped ? "over_budget" : "sandbox_unavailable",
      stored: specValue === undefined ? "unread" : "legacy_spec_value",
      legacy_spec_value: specValue ?? null,
    });
    if (specValue !== undefined) {
      return {
        scoreValue: specValue,
        parseStatus: null,
        scoreSummary: null,
        scoreSource: null,
        codeVersion: 0,
      };
    }
  }

  return {
    scoreValue: scored.scoreValue,
    parseStatus: scored.parseStatus,
    scoreSummary: scored.scoreSummary,
    scoreSource: "parsed",
    codeVersion: game.codeVersion,
  };
}

/** What posting `scoreRaw` to `game` would store — the paste sheet's dry run. */
export async function previewScore(
  game: GameCodeColumns,
  scoreRaw: string,
): Promise<GameScorePreview> {
  const scored = await scoreShareWithinBudget(game, scoreRaw);
  return {
    parseStatus: scored.parseStatus,
    scoreValue: scored.scoreValue,
    scoreSummary: scored.scoreSummary,
  };
}

/**
 * The server-computed fields of a score for an API response: present only
 * when stored code parsed the row. Rows the legacy parser wrote get nothing,
 * so their payload is exactly what it was before these fields existed.
 */
export function scoreCodeFields(row: {
  parseStatus: string | null;
  scoreSummary: string | null;
}): ScoreCodeFields {
  if (!isParseStatus(row.parseStatus)) return {};
  return { parseStatus: row.parseStatus, scoreSummary: row.scoreSummary };
}

/**
 * Start the sandbox worker ahead of the first score post when code parsing is
 * on for everyone, so a cold container pays for it during init (full CPU)
 * instead of inside a request (a fraction of a vCPU). With the flag off this
 * does nothing — beta accounts then start it lazily on their first post.
 */
export function warmGameCodeSandboxIfEnabled(): void {
  try {
    if (getConfig().gameCodeParsing === "off") return;
  } catch {
    // Config problems surface on the first request, with a proper error.
    return;
  }
  void warmGameCodeSandbox();
}
