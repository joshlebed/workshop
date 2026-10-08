// The one-off re-read of history (docs/highscore-score-validation-spec.md,
// section 8): every score the LEGACY parser wrote — a row with no
// `parse_status` — is run through its game's stored code, so it gets a
// status, a summary and a code version like a score posted today. With
// `includeFailed`, so is every `failed` row an older version of the game's
// code read: the current code may do better.
//
// The operator script (scripts/reread-scores.ts) is a thin CLI over this.
// Everything here works on plain rows, so a dry run can be made from a
// read-only export as well as from a live database.

import { and, eq, sql } from "drizzle-orm";
import { gameScores } from "../../db/schema.js";
import type { DbClient } from "../sql.js";
import { KILLED_DETAIL } from "./runtime.js";
import {
  classifyParseChange,
  PARSE_CHANGES,
  type ParseChange,
  type ParseStatus,
  scoreWithGameCode,
} from "./scoring.js";
import type { GameCodeFailureReason } from "./types.js";

export interface RereadGame {
  id: string;
  title: string;
  gameKey: string | null;
  parseCode: string | null;
  formatCode: string | null;
  codeVersion: number;
}

export interface RereadScore {
  userId: string;
  periodKey: string;
  scoreRaw: string;
  scoreValue: number | null;
  parseStatus: string | null;
  scoreSource: string | null;
  /** The game code version that read the row; null for a legacy row. */
  codeVersion?: number | null;
}

/** What the stored code makes of one legacy row, next to what the row holds today. */
export interface RereadRow {
  userId: string;
  periodKey: string;
  scoreRaw: string;
  /** What the row held when it was read: the write only lands if it still does. */
  oldStatus: string | null;
  oldCodeVersion: number | null;
  oldValue: number | null;
  newValue: number | null;
  newStatus: ParseStatus;
  newSummary: string | null;
  change: ParseChange;
  /** Why the code produced no reading, when `newStatus` is `failed`. */
  failureReason: GameCodeFailureReason | null;
}

export interface GameReread {
  game: RereadGame;
  /** Rows the legacy parser wrote — the ones a re-read is for. */
  legacyRows: number;
  /** `failed` rows an older code version read, re-read with `includeFailed`. */
  failedRows: number;
  /**
   * Rows stored code already read: never touched. A `failed` row the current
   * code version read is one of these — same code, same text, same answer.
   */
  skippedAlreadyRead: number;
  /** Rows whose value the poster picked: never touched, whatever else is true. */
  skippedPicked: number;
  /** Rows left alone because the game has no code and `skipUntaught` was set. */
  skippedUntaught: number;
  /**
   * Rows not decided this run — the sandbox was unavailable, or the game's
   * code kept having to be killed. They stay legacy rows; a later run picks
   * them up. Never written as `failed`: that would blame the code or the
   * share for an infrastructure problem.
   */
  deferred: number;
  counts: Record<ParseChange, number>;
  /** Every decided row, in (period, user) order. */
  rows: RereadRow[];
  /** Apply runs only: rows actually written, and rows that changed under us. */
  written: number;
  changedSinceRead: number;
}

interface RereadOptions {
  /** Leave the rows of a game with no parse code as they are. */
  skipUntaught?: boolean;
  /** Also re-read `failed` rows that an older version of the game's code read. */
  includeFailed?: boolean;
  /** Rows read (and, on apply, written) per batch. */
  batchSize?: number;
  /** Called with each decided batch, in order. Apply writes from here. */
  onBatch?: (rows: RereadRow[]) => Promise<{ written: number; changedSinceRead: number }>;
}

const DEFAULT_BATCH_SIZE = 100;

// Code that has to be killed costs a quarter of a second and a worker restart
// each time. A game that does it repeatedly is broken for this run: stop, and
// leave the rest of its rows for after the code is fixed.
const MAX_KILLS_PER_GAME = 3;

function emptyCounts(): Record<ParseChange, number> {
  const counts = {} as Record<ParseChange, number>;
  for (const change of PARSE_CHANGES) counts[change] = 0;
  return counts;
}

/**
 * Re-read one game's legacy rows. Read-only unless `onBatch` writes. Rows run
 * through the sandbox one at a time, each under the sandbox's own limits, in
 * batches of `batchSize` — so memory and the time between writes stay bounded
 * however long the game's history is.
 */
export async function rereadGame(
  game: RereadGame,
  scores: ReadonlyArray<RereadScore>,
  options: RereadOptions = {},
): Promise<GameReread> {
  const result: GameReread = {
    game,
    legacyRows: 0,
    failedRows: 0,
    skippedAlreadyRead: 0,
    skippedPicked: 0,
    skippedUntaught: 0,
    deferred: 0,
    counts: emptyCounts(),
    rows: [],
    written: 0,
    changedSinceRead: 0,
  };
  const legacy: RereadScore[] = [];
  for (const score of scores) {
    if (score.scoreSource === "picked") result.skippedPicked += 1;
    else if (score.parseStatus === null) {
      result.legacyRows += 1;
      legacy.push(score);
    } else if (
      options.includeFailed &&
      score.parseStatus === "failed" &&
      game.parseCode !== null &&
      (score.codeVersion ?? -1) < game.codeVersion
    ) {
      result.failedRows += 1;
      legacy.push(score);
    } else result.skippedAlreadyRead += 1;
  }
  if (game.parseCode === null && options.skipUntaught) {
    result.skippedUntaught = legacy.length;
    return result;
  }

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const code = { parseCode: game.parseCode, formatCode: game.formatCode };
  let kills = 0;
  for (let start = 0; start < legacy.length; start += batchSize) {
    const batch: RereadRow[] = [];
    for (const score of legacy.slice(start, start + batchSize)) {
      if (kills >= MAX_KILLS_PER_GAME) {
        result.deferred += 1;
        continue;
      }
      const read = await scoreWithGameCode(code, score.scoreRaw);
      const failure = read.parse.kind === "failed" ? read.parse : null;
      if (failure?.reason === "sandbox_unavailable") {
        result.deferred += 1;
        continue;
      }
      if (failure?.detail === KILLED_DETAIL) kills += 1;
      const change = classifyParseChange(score.scoreValue, read.parseStatus, read.scoreValue);
      result.counts[change] += 1;
      batch.push({
        userId: score.userId,
        periodKey: score.periodKey,
        scoreRaw: score.scoreRaw,
        oldStatus: score.parseStatus,
        oldCodeVersion: score.codeVersion ?? null,
        oldValue: score.scoreValue,
        newValue: read.scoreValue,
        newStatus: read.parseStatus,
        newSummary: read.scoreSummary,
        change,
        failureReason: failure?.reason ?? null,
      });
    }
    if (batch.length === 0) continue;
    result.rows.push(...batch);
    if (options.onBatch) {
      const wrote = await options.onBatch(batch);
      result.written += wrote.written;
      result.changedSinceRead += wrote.changedSinceRead;
    }
  }
  return result;
}

/**
 * Write one batch of re-read rows, in one transaction. Each row is written
 * only if it is still the row that was read: same status and code version
 * (still a legacy row, or still the same `failed` reading), same text, not
 * picked. A score re-posted or corrected while the re-read was
 * running is left as its owner made it and counted in `changedSinceRead`.
 *
 * Only the reading changes. `period_key`, `created_at` and `updated_at` are
 * not touched and no row is added or removed, so nothing that counts days
 * played — streaks — or shows "posted 2h ago" moves.
 */
export async function writeRereadBatch(
  db: DbClient,
  game: Pick<RereadGame, "id" | "codeVersion">,
  rows: ReadonlyArray<RereadRow>,
): Promise<{ written: number; changedSinceRead: number }> {
  return db.transaction(async (tx) => {
    let written = 0;
    for (const row of rows) {
      const updated = await tx
        .update(gameScores)
        .set({
          scoreValue: row.newValue === null ? null : String(row.newValue),
          parseStatus: row.newStatus,
          scoreSummary: row.newSummary,
          scoreSource: "parsed",
          codeVersion: game.codeVersion,
        })
        .where(
          and(
            eq(gameScores.gameId, game.id),
            eq(gameScores.userId, row.userId),
            eq(gameScores.periodKey, row.periodKey),
            sql`${gameScores.parseStatus} IS NOT DISTINCT FROM ${row.oldStatus}`,
            sql`${gameScores.codeVersion} IS NOT DISTINCT FROM ${row.oldCodeVersion}`,
            eq(gameScores.scoreRaw, row.scoreRaw),
            sql`${gameScores.scoreSource} IS DISTINCT FROM 'picked'`,
          ),
        )
        .returning({ userId: gameScores.userId });
      written += updated.length;
    }
    return { written, changedSinceRead: rows.length - written };
  });
}

/** The counts of one game's re-read as log fields (`kind: "score_reread"`). */
export function rereadLogFields(reread: GameReread, mode: "dry_run" | "applied") {
  return {
    kind: "score_reread",
    mode,
    game_id: reread.game.id,
    game_key: reread.game.gameKey,
    game_title: reread.game.title,
    code_version: reread.game.codeVersion,
    has_code: reread.game.parseCode !== null,
    legacy_rows: reread.legacyRows,
    failed_rows: reread.failedRows,
    unchanged: reread.counts.same_score,
    gains_value: reread.counts.null_to_score,
    value_changes: reread.counts.score_changed,
    loses_value: reread.counts.score_to_failed + reread.counts.score_to_no_result,
    becomes_no_result: reread.counts.null_to_no_result,
    becomes_failed: reread.counts.null_to_failed,
    deferred: reread.deferred,
    skipped_already_read: reread.skippedAlreadyRead,
    skipped_picked: reread.skippedPicked,
    skipped_untaught: reread.skippedUntaught,
    written: reread.written,
    changed_since_read: reread.changedSinceRead,
  };
}
