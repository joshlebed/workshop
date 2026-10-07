// Changing a game's stored code, safely: validate the candidate against what
// the game's stored scores are known to parse to, and write it — with a
// revision row — only when it passes. The operator script
// (scripts/set-game-code.ts) is a thin CLI over this; the teach flow will
// call the same two functions.

import { and, eq, sql } from "drizzle-orm";
import { type DbGame, gameCodeRevisions, gameScores, games } from "../../db/schema.js";
import type { DbClient } from "../sql.js";
import { type CodeExample, type CodeMismatch, validateCode } from "./runtime.js";
import { isParseStatus } from "./scoring.js";

export interface CandidateCode {
  parseCode: string | null;
  formatCode: string | null;
}

interface StoredScore {
  userId: string;
  periodKey: string;
  scoreRaw: string;
  scoreValue: string | null;
  parseStatus: string | null;
}

/**
 * What a stored score is known to parse to.
 * - Parsed by stored code (`parse_status` set): its status is the truth.
 * - Parsed by the legacy parser with a number: that number.
 * - Parsed by the legacy parser to NULL: unknown — it was either a loss or a
 *   share the old parser could not read, and nothing recorded which.
 * - `failed`: unknown — new code is allowed to do better.
 */
function expectationFor(score: StoredScore): Pick<CodeExample, "expected"> {
  if (isParseStatus(score.parseStatus)) {
    if (score.parseStatus === "score") return { expected: Number(score.scoreValue) };
    return score.parseStatus === "no_result" ? { expected: null } : {};
  }
  return score.scoreValue === null ? {} : { expected: Number(score.scoreValue) };
}

interface GameCodePlan {
  /** Stored scores the candidate was run against. */
  storedScores: number;
  /** How many of those have a known expected result. */
  storedWithExpectation: number;
  /** Stored scores the candidate reads differently from what is known. */
  storedMismatches: Array<CodeMismatch & { userId: string; periodKey: string }>;
  /** Operator-supplied examples the candidate gets wrong. */
  exampleMismatches: CodeMismatch[];
  /** True when the candidate could be stored with no further acknowledgement. */
  ok: boolean;
}

/**
 * Run candidate code against every stored score of a game, plus any extra
 * labelled examples. Read-only.
 */
export async function planGameCodeChange(
  db: DbClient,
  game: Pick<DbGame, "id">,
  candidate: CandidateCode,
  extraExamples: ReadonlyArray<CodeExample> = [],
): Promise<GameCodePlan> {
  if (candidate.parseCode === null) {
    throw new Error("a game's parse code cannot be removed; replace it instead");
  }
  const code = { parse: candidate.parseCode, format: candidate.formatCode };
  const stored: StoredScore[] = await db
    .select({
      userId: gameScores.userId,
      periodKey: gameScores.periodKey,
      scoreRaw: gameScores.scoreRaw,
      scoreValue: gameScores.scoreValue,
      parseStatus: gameScores.parseStatus,
    })
    .from(gameScores)
    .where(eq(gameScores.gameId, game.id))
    .orderBy(gameScores.periodKey, gameScores.userId);

  const storedExamples = stored.map((score) => ({ raw: score.scoreRaw, ...expectationFor(score) }));
  const storedReport = await validateCode(code, storedExamples);
  const exampleReport = await validateCode(code, extraExamples);
  const storedMismatches = storedReport.mismatches.map((mismatch) => {
    const score = stored[mismatch.index];
    return { ...mismatch, userId: score?.userId ?? "", periodKey: score?.periodKey ?? "" };
  });
  return {
    storedScores: stored.length,
    storedWithExpectation: storedExamples.filter((e) => e.expected !== undefined).length,
    storedMismatches,
    exampleMismatches: exampleReport.mismatches,
    ok: storedReport.ok && exampleReport.ok,
  };
}

type GameCodeSource = "operator" | "teach";

/**
 * Store new code on a game and record the revision, in one transaction.
 * Does NOT validate — call `planGameCodeChange` first and decide. Does not
 * touch stored scores either: rows keep what they were parsed to, and their
 * `code_version` shows they predate this change.
 */
export async function applyGameCodeChange(
  db: DbClient,
  input: {
    gameId: string;
    candidate: CandidateCode;
    source: GameCodeSource;
    authoredBy: string | null;
    note: string;
    examples: ReadonlyArray<CodeExample>;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(games)
      .set({
        parseCode: input.candidate.parseCode,
        formatCode: input.candidate.formatCode,
        codeVersion: sql`${games.codeVersion} + 1`,
      })
      .where(eq(games.id, input.gameId))
      .returning({ version: games.codeVersion });
    if (!row) throw new Error(`no game ${input.gameId}`);
    await tx.insert(gameCodeRevisions).values({
      gameId: input.gameId,
      version: row.version,
      parseCode: input.candidate.parseCode,
      formatCode: input.candidate.formatCode,
      source: input.source,
      authoredBy: input.authoredBy,
      note: input.note,
      examples: [...input.examples],
    });
    return { version: row.version };
  });
}

/** The code a past version of a game held (for a revert). */
export async function gameCodeAtVersion(
  db: DbClient,
  gameId: string,
  version: number,
): Promise<CandidateCode | null> {
  const [row] = await db
    .select({ parseCode: gameCodeRevisions.parseCode, formatCode: gameCodeRevisions.formatCode })
    .from(gameCodeRevisions)
    .where(and(eq(gameCodeRevisions.gameId, gameId), eq(gameCodeRevisions.version, version)))
    .limit(1);
  return row ?? null;
}
