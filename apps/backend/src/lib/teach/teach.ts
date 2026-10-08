// Teach orchestration: turn one user's confirmed pick into new parser code.
//
//   pick (already stored) → write code (LLM) → acceptance gates (sandbox)
//     → accept / switch / conflict / reject → apply in one transaction
//
// The pick has already fixed the user's own score before any of this runs,
// and nothing here can undo that: when the model is down, slow, or writes
// code that fails a gate, the game simply stays as it was.

import { formatShareBodyFallback } from "@workshop/shared/gameRegistry";
import type { GameScoreDirection, TeachOutcome } from "@workshop/shared/games";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { type DbGame, type DbGameScore, gameScores, games } from "../../db/schema.js";
import { applyGameCodeChange, gameCodeAtVersion } from "../gameCode/admin.js";
import { runFormat, runParse } from "../gameCode/runtime.js";
import type { ParseResult } from "../gameCode/types.js";
import { logger } from "../logger.js";
import { notifyParserTaught } from "../opsNotifications.js";
import type { DbClient } from "../sql.js";
import {
  type CodeEvaluation,
  decide,
  describeFailures,
  evaluateCode,
  type RowReading,
  type TeachDecision,
} from "./acceptance.js";
import { claimTeachLlmCall } from "./budget.js";
import { teachModeFor } from "./gate.js";
import { logTeachEvent, type TeachLogContext } from "./log.js";
import { isAdjusted, logSandboxFailure, storedPickOf, windowStartKey } from "./scores.js";
import { pickValue, type StoredPick, type WindowScore } from "./types.js";
import { describePick, type PromptExample, WRITE_CODE_TIMEOUT_MS, writeCode } from "./writeCode.js";

/**
 * Everything a teach request may spend, LLM calls and gates together. The
 * Lambda times out at 15s; this leaves room for the DB work on either side.
 */
const TEACH_BUDGET_MS = 12_000;
/** Not worth starting the retry with less than this left. */
const MIN_RETRY_MS = 2_500;
/** Kept back from the retry's timeout for its gates and the write. */
const RETRY_RESERVE_MS = 1_500;
/** Kept back from the gates for the transaction that stores the result. */
const APPLY_RESERVE_MS = 800;
/** After the write: how long re-deriving "adjusted" may run before the response goes out. */
const ADJUSTED_BUDGET_MS = 1_000;
/** The window is read newest-first and capped. */
const WINDOW_ROW_LIMIT = 1_000;
/**
 * What one evaluation is checked against: the newest parsed rows up to this
 * many distinct texts, plus the newest confirmed picks. Each distinct text is
 * one sandbox run (two for a row from before code parsing), so these two
 * numbers bound the work — see `worstCaseSandboxRuns`.
 */
const MAX_WINDOW_TEXTS = 200;
const MAX_WINDOW_PICKS = 40;
const MAX_PROMPT_LOSSES = 2;
const MAX_PROMPT_READS = 4;
const MAX_PROMPT_PICKS = 2;
/** Current-code runs spent choosing prompt examples among rows from before code parsing. */
const MAX_PROMPT_PROBES = 12;
const MAX_ADJUSTED_ROWS = 100;
/** Model calls per teach: the one retry after a gate failure, or after a slow call. */
const MAX_MODEL_CALLS = 2;

/**
 * The most sandbox runs one teach can make, whatever the game's history
 * looks like. Per evaluation the candidate runs once on the example, on each
 * distinct window text, and on each pick's text and its (at most two)
 * alterations; the current code runs once per distinct text across the whole
 * teach. `teach.test.ts` pins the arithmetic.
 */
export const worstCaseSandboxRuns = {
  perEvaluation: 1 + MAX_WINDOW_TEXTS + MAX_WINDOW_PICKS * 3,
  currentCode: 1 + MAX_PROMPT_PROBES + MAX_WINDOW_TEXTS + MAX_WINDOW_PICKS,
  adjusted: MAX_ADJUSTED_ROWS,
  /** Format runs for re-read rows that had no summary — only for a game with format code. */
  summaries: MAX_WINDOW_TEXTS,
  get total() {
    return this.perEvaluation * MAX_MODEL_CALLS + this.currentCode + this.adjusted + this.summaries;
  },
};

function toWindowScore(row: DbGameScore): WindowScore {
  const status =
    row.parseStatus === "score" || row.parseStatus === "no_result" || row.parseStatus === "failed"
      ? row.parseStatus
      : null;
  const pick = row.scoreSource === "picked" ? storedPickOf(row.pick) : null;
  return {
    userId: row.userId,
    periodKey: row.periodKey,
    raw: row.scoreRaw,
    status,
    value: row.scoreValue === null ? null : Number(row.scoreValue),
    // A picked row whose pick cannot be read back is treated as parsed-by-nobody:
    // it never constrains new code and is never rewritten.
    source: row.scoreSource === "picked" ? "picked" : "parsed",
    codeVersion: row.codeVersion,
    summary: row.scoreSummary,
    pick,
    isExample: row.pickIsExample && pick !== null,
  };
}

/** Every score for the game in the 30-day window, newest first (index-bounded). */
async function loadWindow(gameId: string, db: DbClient): Promise<WindowScore[]> {
  const rows = await db
    .select()
    .from(gameScores)
    .where(and(eq(gameScores.gameId, gameId), gte(gameScores.periodKey, windowStartKey())))
    .orderBy(desc(gameScores.periodKey))
    .limit(WINDOW_ROW_LIMIT);
  return rows.map(toWindowScore);
}

/**
 * The slice of the window an evaluation runs over: every row of the teacher's
 * that matters, the newest confirmed picks, and the newest parsed rows up to
 * `MAX_WINDOW_TEXTS` distinct texts. Rows past the cut are neither checked
 * nor rewritten — they keep exactly what they hold.
 */
export function sampleWindow(
  window: readonly WindowScore[],
  example: WindowScore,
): { sample: WindowScore[]; truncated: boolean } {
  const sample: WindowScore[] = [];
  const texts = new Set<string>([example.raw]);
  let picks = 0;
  let truncated = false;
  for (const row of window) {
    const isExample = row.userId === example.userId && row.periodKey === example.periodKey;
    if (isExample) {
      sample.push(row);
    } else if (row.source === "picked") {
      // A pick that is not a training example constrains nothing.
      if (!row.isExample) continue;
      if (picks >= MAX_WINDOW_PICKS) truncated = true;
      else {
        picks += 1;
        sample.push(row);
      }
    } else if (texts.has(row.raw)) {
      sample.push(row);
    } else if (texts.size > MAX_WINDOW_TEXTS) {
      truncated = true;
    } else {
      texts.add(row.raw);
      sample.push(row);
    }
  }
  return { sample, truncated };
}

/**
 * The rows a switch re-reads: other users' read rows the new code reads
 * differently, but only those the outvoted parser version itself produced.
 * A row read by an earlier version (or before code parsing) keeps its value —
 * stored values do not move for a parser they never came from.
 */
function rowsReadByOutvoted(evaluation: CodeEvaluation, game: DbGame): RowReading[] {
  return evaluation.changedReads.filter((r) => r.readByVersion === game.codeVersion);
}

/**
 * The display text for re-read rows that have none. A row stored by code
 * parsing already has its summary (teach never changes format code); a row
 * from before code parsing does not, and a status with no summary reads to a
 * client as "nothing to show". The game's formatter writes it when there is
 * one and time allows; otherwise it is the cleaned share text, the same thing
 * an ordinary post stores for a game with no formatter.
 */
async function summariesFor(
  game: DbGame,
  rows: readonly RowReading[],
  deadlineMs: number,
): Promise<Map<string, string | null>> {
  const byRaw = new Map<string, string | null>();
  for (const row of rows) {
    if (row.storedSummary !== null || byRaw.has(row.raw)) continue;
    let summary = formatShareBodyFallback(row.raw);
    if (game.formatCode !== null && Date.now() < deadlineMs) {
      const formatted = await runFormat(game.formatCode, row.raw);
      if (formatted.kind === "summary") summary = formatted.text;
    }
    byRaw.set(row.raw, summary);
  }
  return byRaw;
}

function matchesPick(pick: StoredPick, parse: ParseResult): boolean {
  const expected = pickValue(pick);
  if (expected === null) return parse.kind === "noResult";
  return parse.kind === "score" && parse.value === expected;
}

/**
 * Shares the new code must keep right, for the prompt. Only used when the
 * current parser could not read the example at all (a new format): then what
 * it does read today is a different shape, and keeping it is exactly the job.
 * When the parser reads the example *wrongly*, same-shaped shares would be
 * contradictory instructions — the gates decide that case, not the prompt.
 */
async function alsoCorrectFor(
  game: DbGame,
  example: WindowScore,
  window: readonly WindowScore[],
  currentResults: Map<string, ParseResult>,
): Promise<PromptExample[]> {
  let probes = 0;
  const seen = new Set([example.raw]);
  const losses: PromptExample[] = [];
  const reads: PromptExample[] = [];
  const picks: PromptExample[] = [];
  for (const row of window) {
    if (seen.has(row.raw)) continue;
    if (row.source === "picked") {
      if (!row.isExample || !row.pick || row.userId === example.userId) continue;
      if (picks.length >= MAX_PROMPT_PICKS) continue;
      seen.add(row.raw);
      picks.push({
        raw: row.raw,
        expected: pickValue(row.pick),
        derivation: describePick(row.raw, row.pick),
      });
      continue;
    }
    if (row.status === "no_result" && losses.length < MAX_PROMPT_LOSSES) {
      seen.add(row.raw);
      losses.push({ raw: row.raw, expected: null });
    } else if (row.value !== null && reads.length < MAX_PROMPT_READS && game.parseCode !== null) {
      // A row from before code parsing counts only if today's code agrees with it.
      if (row.status !== "score") {
        if (probes >= MAX_PROMPT_PROBES) continue;
        probes += 1;
        const current = await runParse(game.parseCode, row.raw);
        // Kept for the gates, which ask the same question of the same text.
        if (current.kind !== "failed" || current.reason !== "sandbox_unavailable") {
          currentResults.set(row.raw, current);
        }
        if (current.kind !== "score" || current.value !== row.value) continue;
      }
      seen.add(row.raw);
      reads.push({ raw: row.raw, expected: row.value });
    }
  }
  return [...picks, ...losses, ...reads];
}

interface Attempt {
  code: string;
  evaluation: CodeEvaluation;
  decision: TeachDecision;
}

interface TeachResult {
  outcome: TeachOutcome;
  game: DbGame;
  score: DbGameScore;
}

function oneLine(raw: string, limit = 80): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/**
 * Teach the game's parser from the caller's own picked score for one day.
 * Never throws for anything the model or the generated code does.
 */
export async function teachFromPick(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  periodKey: string;
  scoreDirection?: GameScoreDirection | undefined;
  db?: DbClient;
  fetchImpl?: typeof fetch;
}): Promise<TeachResult | null> {
  const { userId, game, periodKey } = input;
  const db = input.db ?? getDb();
  const context = { ...input.context, parserVersion: game.codeVersion };
  const startedAt = Date.now();
  const deadline = startedAt + TEACH_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  const mine = and(
    eq(gameScores.gameId, game.id),
    eq(gameScores.userId, userId),
    eq(gameScores.periodKey, periodKey),
  );
  const [row] = await db.select().from(gameScores).where(mine).limit(1);
  if (!row) return null;
  const example = toWindowScore(row);
  const pick = example.pick;
  const trigger = game.parseCode === null ? "first_teach" : "correction";
  const done = (outcome: TeachOutcome, updated: DbGame = game, score: DbGameScore = row) => ({
    outcome,
    game: updated,
    score,
  });
  const skip = (outcome: TeachOutcome, reason: string) => {
    logTeachEvent("parser_accept", context, { trigger, outcome, reason, raw: example.raw });
    return done(outcome);
  };

  if (!pick || !example.isExample) {
    return skip("not_eligible", pick ? "not a training example" : "score is not a pick");
  }
  const current = game.parseCode === null ? null : await runParse(game.parseCode, example.raw);
  if (current && matchesPick(pick, current)) {
    if (row.pickAdjusted) await db.update(gameScores).set({ pickAdjusted: false }).where(mine);
    return skip("not_needed", "the parser already reads this pick");
  }
  // "I didn't finish" teaches a loss shape the parser could not read — never
  // a first parser, and never over a score the parser does read.
  if (pick.kind === "no_result" && current?.kind !== "failed") {
    return skip("not_eligible", "a no-result pick only teaches a share the parser cannot read");
  }

  const loaded = await loadWindow(game.id, db);
  const isExampleRow = (r: WindowScore) => r.userId === userId && r.periodKey === periodKey;
  // A "Fix score" on an older day teaches from a row outside the window.
  const all = loaded.some(isExampleRow) ? loaded : [example, ...loaded];
  // Bounded work whatever the game's history: see `sampleWindow`.
  const { sample: window, truncated } = sampleWindow(all, example);
  const currentResults = new Map<string, ParseResult>();
  // The parser could not read the example: extend it, keeping what it reads.
  // It read the example differently: the pick says the parser is wrong.
  const extending = current === null || current.kind === "failed";
  const alsoCorrect = extending ? await alsoCorrectFor(game, example, window, currentResults) : [];
  const promptExample: PromptExample = {
    raw: example.raw,
    expected: pickValue(pick),
    derivation: describePick(example.raw, pick),
  };

  // At most two model calls per teach, whatever they are spent on: the one
  // retry after a gate failure, or a second try after a slow or failed call.
  const attempts: Attempt[] = [];
  let noVerdict = false;
  let previous: { code: string; feedback: string } | undefined;
  for (let attempt = 1; attempt <= MAX_MODEL_CALLS; attempt++) {
    const timeoutMs =
      attempt === 1
        ? WRITE_CODE_TIMEOUT_MS
        : Math.min(WRITE_CODE_TIMEOUT_MS, remaining() - RETRY_RESERVE_MS);
    if (attempt > 1 && remaining() < MIN_RETRY_MS) break;
    // The global daily cap on model calls; spent means no teach today.
    if (!(await claimTeachLlmCall("write_code", context, db))) {
      logTeachEvent("parser_accept", context, {
        trigger,
        attempt,
        outcome: "unavailable",
        reason: "daily model budget exhausted",
        raw: example.raw,
      });
      break;
    }
    const written = await writeCode(
      {
        gameTitle: game.title,
        example: promptExample,
        alsoCorrect,
        currentCode: game.parseCode,
        previous,
      },
      { timeoutMs, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) },
    );
    if (!written.ok) {
      logTeachEvent("parser_accept", context, {
        trigger,
        attempt,
        model: written.model,
        outcome: "unavailable",
        reason: written.reason,
        step: "write_code",
        llm_ms: written.durationMs,
        llm_budget_ms: timeoutMs,
        llm_timed_out: written.reason === "timeout",
        elapsed_ms: Date.now() - startedAt,
        raw: example.raw,
      });
      // A slow or failed call gets the one remaining attempt, with the same prompt.
      continue;
    }
    const gatesStartedAt = Date.now();
    const evaluation = await evaluateCode({
      code: written.code,
      currentCode: game.parseCode,
      example,
      window,
      currentResults,
      // Never past the point where the result could still be stored in time.
      deadlineMs: deadline - APPLY_RESERVE_MS,
    });
    const decision = decide(evaluation);
    attempts.push({ code: written.code, evaluation, decision });
    const firstFailure = evaluation.failures[0];
    const rereadable = evaluation.rereads.filter((r) => teachModeFor(r.userId) === "on").length;
    const rereadOnSwitch = rowsReadByOutvoted(evaluation, game).filter(
      (r) => teachModeFor(r.userId) === "on",
    ).length;
    logTeachEvent("parser_accept", context, {
      trigger: decision === "switch" ? "second_user" : trigger,
      attempt,
      model: written.model,
      outcome: evaluation.noVerdict ? "no_verdict" : decision,
      no_verdict: evaluation.noVerdict,
      failed_gate: evaluation.failedGate,
      failure: firstFailure
        ? {
            raw: firstFailure.raw,
            expected: firstFailure.expected,
            actual: firstFailure.actual,
            note: firstFailure.note ?? null,
          }
        : null,
      // On a switch: rows the outvoted version read, now re-read — and rows
      // the new code also reads differently that keep their stored value.
      rows_changed: decision === "switch" ? rereadOnSwitch : 0,
      rows_differing_kept:
        decision === "switch" ? evaluation.changedReads.length - rereadOnSwitch : 0,
      // Rows this teach will write a new reading to — and rows the code can
      // also read that belong to accounts teach is off for, left as they are.
      rows_newly_read: rereadable,
      rows_readable_not_rewritten: evaluation.rereads.length - rereadable,
      correcting_users: evaluation.correctingUsers,
      conflicting_users: evaluation.conflictingUsers,
      window_rows: all.length,
      window_checked: window.length,
      window_truncated: truncated,
      sandbox_runs: evaluation.runs,
      // Step 2's latency for this attempt: the model call, the budget it was
      // given, the gates, and how far into the teach request this line is.
      step: "write_code",
      llm_ms: written.durationMs,
      llm_budget_ms: timeoutMs,
      llm_timed_out: false,
      gates_ms: Date.now() - gatesStartedAt,
      elapsed_ms: Date.now() - startedAt,
      input_tokens: written.usage.inputTokens,
      output_tokens: written.usage.outputTokens,
      code: written.code,
      raw: example.raw,
    });
    if (evaluation.failedGate === "sandbox_limit" && firstFailure) {
      logSandboxFailure(context, firstFailure.actual, "candidate", Date.now() - gatesStartedAt);
    }
    if (decision === "accept" || decision === "switch") break;
    // The sandbox went away or the time ran out mid-check: nothing was
    // learned about this code, so there is nothing to feed back and no
    // verdict to act on.
    if (evaluation.noVerdict) {
      attempts.pop();
      noVerdict = true;
      break;
    }
    // Feeding a disagreement with someone else's score back to the model only
    // helps when the two can both be right (two formats). When the pick says
    // the current parser is wrong, they cannot — that is for the vote.
    const disagreement =
      evaluation.failedGate === "reproduction" ||
      evaluation.failedGate === "changes_other_read_scores";
    const exampleItself = evaluation.correctingUsers.length === 0;
    if (disagreement && !exampleItself && !extending) break;
    previous = { code: written.code, feedback: describeFailures(evaluation.failures) };
  }

  const winner =
    attempts.find((a) => a.decision === "accept") ??
    attempts.find((a) => a.decision === "switch") ??
    attempts.find((a) => a.decision === "conflict");
  if (!winner) return done(attempts.length === 0 || noVerdict ? "unavailable" : "rejected");

  if (winner.decision === "conflict") {
    await db.update(games).set({ parseConflictAt: new Date() }).where(eq(games.id, game.id));
    const theirs = window.filter((r) =>
      winner.evaluation.conflictingPicks.some(
        (p) => p.userId === r.userId && p.periodKey === r.periodKey,
      ),
    );
    logTeachEvent("pick_conflict", context, {
      users: [userId, ...winner.evaluation.conflictingUsers],
      corrector: { user_id: userId, raw: example.raw, value: pickValue(pick) },
      conflicting: theirs.map((r) => ({
        user_id: r.userId,
        period_key: r.periodKey,
        raw: r.raw,
        value: r.pick ? pickValue(r.pick) : r.value,
      })),
      flag_set: true,
      resolution: null,
    });
    return done("conflict", { ...game, parseConflictAt: new Date() });
  }

  const switched = winner.decision === "switch";
  const applied = await applyNewCode({
    db,
    game,
    userId,
    code: winner.code,
    evaluation: winner.evaluation,
    switched,
    example,
    pick,
    scoreDirection: input.scoreDirection,
    deadlineMs: deadline,
  });
  if (!applied) {
    // Someone else changed the parser while this was being written.
    logTeachEvent("parser_accept", context, {
      trigger,
      outcome: "rejected",
      reason: "concurrent_change",
    });
    return done("rejected");
  }
  // The new code is live; a failure from here on must not turn that into a 500.
  try {
    await recomputeAdjusted(applied.game, db, Date.now() + ADJUSTED_BUDGET_MS);
  } catch (error) {
    logger.error("recompute adjusted after teach failed", { error, gameId: game.id });
  }
  // A switch that settled a conflict between picks closes it in the log; one
  // that outvoted an unconfirmed parser had no conflict to close.
  if (switched && winner.evaluation.conflictingUsers.length > 0) {
    logTeachEvent(
      "pick_conflict",
      { ...context, parserVersion: applied.game.codeVersion },
      {
        users: [...winner.evaluation.correctingUsers, ...winner.evaluation.conflictingUsers],
        flag_set: false,
        resolution: "switched",
        outvoted_users: winner.evaluation.conflictingUsers,
        rows_reread: applied.rowsChanged,
      },
    );
  }
  await notifyParserTaught(userId, {
    gameTitle: game.title,
    version: applied.game.codeVersion,
    kind: switched ? "switch" : game.parseCode === null ? "first" : "reteach",
    example: `${oneLine(example.raw)} → ${pick.kind === "no_result" ? "no result" : pick.feature.value}`,
    rowsNewlyRead: applied.rowsNewlyRead,
    rowsChanged: applied.rowsChanged,
    direction: applied.directionSet,
  });
  const [score] = await db.select().from(gameScores).where(mine).limit(1);
  return done(switched ? "switched" : "accepted", applied.game, score ?? row);
}

/**
 * Store accepted code: bump the version, append the revision, apply the rows
 * the evaluation cleared, and settle the picks it overturned — one
 * transaction. Returns null when the game's code changed underneath us.
 */
async function applyNewCode(input: {
  db: DbClient;
  game: DbGame;
  userId: string;
  code: string;
  evaluation: CodeEvaluation;
  switched: boolean;
  example: WindowScore;
  pick: StoredPick;
  scoreDirection: GameScoreDirection | undefined;
  /** Past this the formatter is not run for missing summaries; the cleaned text is used. */
  deadlineMs: number;
}): Promise<{
  game: DbGame;
  rowsNewlyRead: number;
  rowsChanged: number;
  directionSet: GameScoreDirection | null;
} | null> {
  const { game, userId, code, evaluation, switched } = input;
  // A first teach also says which way scores rank; later changes go through
  // the direction endpoint's two-user rule.
  const directionSet =
    game.parseCode === null && input.scoreDirection ? input.scoreDirection : null;
  // Stored scores of accounts outside the teach rollout stay exactly as they
  // are until the flag is on for them (the one-off re-read covers them).
  const mayRewrite = (reading: RowReading) => teachModeFor(reading.userId) === "on";
  const rereads = evaluation.rereads.filter(mayRewrite);
  const changed = switched ? rowsReadByOutvoted(evaluation, game).filter(mayRewrite) : [];
  const dropped = [...evaluation.overturnedPicks, ...(switched ? evaluation.conflictingPicks : [])];
  // Computed before the transaction opens: it may run the formatter.
  const summaries = await summariesFor(game, [...rereads, ...changed], input.deadlineMs);

  return input.db.transaction(async (tx) => {
    // Lock the game row and make sure nobody changed its code while this
    // teach was being written and checked.
    const [locked] = await tx
      .select({ codeVersion: games.codeVersion })
      .from(games)
      .where(eq(games.id, game.id))
      .for("update");
    if (!locked || locked.codeVersion !== game.codeVersion) return null;
    // The foundation's writer: bumps `code_version` and appends the revision.
    await applyGameCodeChange(tx, {
      gameId: game.id,
      candidate: { parseCode: code, formatCode: game.formatCode },
      source: "teach",
      authoredBy: userId,
      note: switched
        ? "teach v2: switched on a second agreeing user"
        : game.parseCode === null
          ? "teach v2: first teach"
          : "teach v2: correction",
      examples: [{ raw: input.example.raw, expected: pickValue(input.pick) }],
    });
    const [updated] = await tx
      .update(games)
      .set({
        parseConflictAt: null,
        ...(directionSet ? { scoreDirection: directionSet, directionSetBy: userId } : {}),
      })
      .where(eq(games.id, game.id))
      .returning();
    if (!updated) return null;
    for (const reading of [...rereads, ...changed]) {
      await tx
        .update(gameScores)
        .set({
          scoreValue: reading.result.kind === "score" ? String(reading.result.value) : null,
          parseStatus: reading.result.kind === "score" ? "score" : "no_result",
          codeVersion: game.codeVersion + 1,
          scoreSource: "parsed",
          // Only for a row that had none; a stored summary stays as it is.
          ...(reading.storedSummary === null
            ? { scoreSummary: summaries.get(reading.raw) ?? null }
            : {}),
        })
        .where(
          and(
            eq(gameScores.gameId, game.id),
            eq(gameScores.userId, reading.userId),
            eq(gameScores.periodKey, reading.periodKey),
            // Never a row that became someone's own pick in the meantime.
            or(eq(gameScores.scoreSource, "parsed"), isNull(gameScores.scoreSource)),
          ),
        );
    }
    for (const ref of dropped) {
      await tx
        .update(gameScores)
        .set({ pickIsExample: false })
        .where(
          and(
            eq(gameScores.gameId, game.id),
            eq(gameScores.userId, ref.userId),
            eq(gameScores.periodKey, ref.periodKey),
          ),
        );
    }
    return {
      game: updated,
      rowsNewlyRead: rereads.length,
      rowsChanged: changed.length,
      directionSet,
    };
  });
}

/**
 * Re-derive "adjusted" for the game's picked rows against its current code:
 * a picked score is adjusted while the parser reads its text differently.
 * Run after every parser version change. Bounded — picks are rare.
 */
async function recomputeAdjusted(
  game: DbGame,
  db: DbClient = getDb(),
  deadlineMs = Number.POSITIVE_INFINITY,
): Promise<void> {
  const rows = await db
    .select()
    .from(gameScores)
    .where(and(eq(gameScores.gameId, game.id), eq(gameScores.scoreSource, "picked")))
    .orderBy(desc(gameScores.periodKey))
    .limit(MAX_ADJUSTED_ROWS);
  for (const [index, row] of rows.entries()) {
    if (Date.now() > deadlineMs) {
      // Out of time: the rows not reached keep the label they had.
      logger.warn("recompute adjusted stopped at its deadline", {
        gameId: game.id,
        checked: index,
        remaining: rows.length - index,
      });
      return;
    }
    const pick = storedPickOf(row.pick);
    // "I didn't finish" is never labelled.
    let adjusted = false;
    if (pick?.kind === "feature" && game.parseCode !== null) {
      adjusted = isAdjusted(pick, await runParse(game.parseCode, row.scoreRaw));
    }
    if (adjusted === row.pickAdjusted) continue;
    await db
      .update(gameScores)
      .set({ pickAdjusted: adjusted })
      .where(
        and(
          eq(gameScores.gameId, row.gameId),
          eq(gameScores.userId, row.userId),
          eq(gameScores.periodKey, row.periodKey),
        ),
      );
  }
}

/**
 * Restore an earlier version of a game's code. History is never rewritten:
 * the old code is written back as a new version with its own revision row.
 * Stored scores do not move; only "adjusted" is re-derived.
 */
export async function rollbackParser(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  toVersion: number;
  db?: DbClient;
}): Promise<DbGame | null> {
  const { game, toVersion } = input;
  const db = input.db ?? getDb();
  const target =
    toVersion === game.codeVersion ? null : await gameCodeAtVersion(db, game.id, toVersion);
  if (!target || target.parseCode === null) return null;
  // One transaction: the code, its revision and the cleared conflict flag
  // land together or not at all.
  const { version, updated } = await db.transaction(async (tx) => {
    const applied = await applyGameCodeChange(tx, {
      gameId: game.id,
      candidate: target,
      source: "operator",
      authoredBy: input.userId,
      note: `rollback to version ${toVersion}`,
      examples: [],
    });
    const [row] = await tx
      .update(games)
      .set({ parseConflictAt: null })
      .where(eq(games.id, game.id))
      .returning();
    return { version: applied.version, updated: row };
  });
  if (!updated) return null;
  try {
    await recomputeAdjusted(updated, db);
  } catch (error) {
    logger.error("recompute adjusted after rollback failed", { error, gameId: game.id });
  }
  logTeachEvent(
    "parser_rollback",
    { ...input.context, parserVersion: version },
    {
      from_version: game.codeVersion,
      to_version: toVersion,
      new_version: version,
    },
  );
  return updated;
}
