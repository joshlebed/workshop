// The acceptance gates for new parser code, in the spec's order:
//
//   1. sandbox limits        — the code loads and runs inside its caps
//   2. the alteration test   — alter each confirmed example; the result must follow
//   3. 30-day reproduction   — every confirmed pick in the window is reproduced
//   4. other read scores     — every other read score in the window is unchanged
//
// plus, for code that passes, which unread rows it can now read. Pure with
// respect to the database: the caller loads the window and applies the result.
// Everything runs through the real sandbox (`runParse`), so a hostile or
// runaway program costs a bounded amount and ends as a failed gate.

import { runParse } from "../gameCode/runtime.js";
import type { ParseResult } from "../gameCode/types.js";
import { alterationsFor, noResultAlteration } from "./alteration.js";
import { type AcceptanceGate, pickValue, type WindowScore } from "./types.js";

type RunParse = (code: string, raw: string) => Promise<ParseResult>;

/** A failure a model can act on: this text must give that, and gave something else. */
interface GateFailure {
  gate: AcceptanceGate;
  raw: string;
  expected: number | null;
  actual: ParseResult;
  /** Whose row it was; absent for an altered copy of the teaching example. */
  userId?: string;
  periodKey?: string;
  note?: string;
}

/** A stored row and what the new code makes of it. */
export interface RowReading {
  userId: string;
  periodKey: string;
  /** The parser version that produced the row's stored value; null before code parsing. */
  readByVersion: number | null;
  result: { kind: "score"; value: number } | { kind: "noResult" };
}

interface RowRef {
  userId: string;
  periodKey: string;
}

export interface CodeEvaluation {
  /** The first gate that failed, in order; null when the code passed all four. */
  failedGate: AcceptanceGate | null;
  failures: GateFailure[];
  /**
   * Users whose confirmed pick is a *correction* the code agrees with: the
   * code reproduces it and the game's current parser does not. The teacher is
   * always one. A user whose pick the current parser already reads is not —
   * their pick still parsing says nothing about wanting the parser changed.
   */
  correctingUsers: string[];
  /** Other users with a confirmed pick in the window that the code contradicts. */
  conflictingUsers: string[];
  /** Those contradicted picks — dropped as examples if the parser switches. */
  conflictingPicks: RowRef[];
  /** The teacher's own earlier picks the code contradicts: a user may overturn their own. */
  overturnedPicks: RowRef[];
  /**
   * Rows the code may be applied to when it is accepted: unread rows it can
   * now read, and the teacher's own parsed rows it reads differently.
   */
  rereads: RowReading[];
  /**
   * Other users' already-read rows the code reads differently (gate 4).
   * Never applied on an accept. On a switch, only those the outvoted parser
   * version itself read are re-read (`readByVersion`); older rows keep what
   * they hold.
   */
  changedReads: RowReading[];
  /**
   * Set when the evaluation stopped without establishing anything about the
   * code: the sandbox itself could not run it (worker gone, start failed), or
   * the deadline passed first. Such code must not be stored, and must not be
   * reported — to the model or the user — as wrong.
   */
  noVerdict: "sandbox_unavailable" | "deadline" | null;
  /** How many sandbox runs the evaluation made. */
  runs: number;
}

/** Failures that are the sandbox's caps talking, wherever they happen. */
const LIMIT_REASONS = new Set(["timeout", "out_of_memory", "too_large", "sandbox_unavailable"]);
/** Failures that mean the code can never work, whatever the input. */
const LOAD_REASONS = new Set(["invalid_code", "missing_function"]);

function hitLimit(result: ParseResult): boolean {
  return (
    result.kind === "failed" &&
    (LIMIT_REASONS.has(result.reason) || LOAD_REASONS.has(result.reason))
  );
}

function matches(expected: number | null, actual: ParseResult): boolean {
  if (expected === null) return actual.kind === "noResult";
  return actual.kind === "score" && actual.value === expected;
}

function storedMatches(row: WindowScore, actual: ParseResult): boolean {
  if (row.status === "no_result") return actual.kind === "noResult";
  return actual.kind === "score" && actual.value === row.value;
}

interface EvaluateInput {
  code: string;
  /** The game's current code, or null when it has none. */
  currentCode: string | null;
  /** The pick being taught from — a confirmed training example. */
  example: WindowScore;
  /** The scores to check the code against: the 30-day window, or the caller's sample of it. */
  window: readonly WindowScore[];
  /**
   * Epoch ms after which no further sandbox run starts. Past it the
   * evaluation ends with `noVerdict: "deadline"` — never an accept.
   */
  deadlineMs?: number;
  /**
   * Results of the game's current code by share text, shared between the
   * attempts of one teach so the current code runs once per text, not twice.
   */
  currentResults?: Map<string, ParseResult>;
  runParse?: RunParse;
}

/** Thrown inside an evaluation to stop it where it stands; never escapes `evaluateCode`. */
class EvaluationStopped extends Error {}

/**
 * Run new code through the gates. Stops at gate 1 or 2 (the code is unusable
 * as written) and at the first sandbox limit anywhere; otherwise runs gates 3
 * and 4 to the end even when one fails, because who is correcting and who is
 * contradicted decides between a conflict and a switch. Bounded in time by
 * `deadlineMs` and in work by the size of `window`.
 */
export async function evaluateCode(input: EvaluateInput): Promise<CodeEvaluation> {
  const evaluation: CodeEvaluation = {
    failedGate: null,
    failures: [],
    correctingUsers: [],
    conflictingUsers: [],
    conflictingPicks: [],
    overturnedPicks: [],
    rereads: [],
    changedReads: [],
    noVerdict: null,
    runs: 0,
  };
  try {
    await runGates(input, evaluation);
  } catch (error) {
    if (!(error instanceof EvaluationStopped)) throw error;
  }
  return evaluation;
}

async function runGates(input: EvaluateInput, evaluation: CodeEvaluation): Promise<void> {
  const run = input.runParse ?? runParse;
  const { code, example } = input;
  // Friends post identical texts; each distinct text is run once per program.
  const cached = (program: string, results = new Map<string, ParseResult>()) => {
    return async (raw: string) => {
      const known = results.get(raw);
      if (known) return known;
      if (input.deadlineMs !== undefined && Date.now() > input.deadlineMs) {
        evaluation.noVerdict = "deadline";
        throw new EvaluationStopped();
      }
      evaluation.runs += 1;
      const result = await run(program, raw);
      if (result.kind === "failed" && result.reason === "sandbox_unavailable") {
        // The sandbox is gone: nothing after this would mean anything.
        evaluation.noVerdict = "sandbox_unavailable";
        throw new EvaluationStopped();
      }
      results.set(raw, result);
      return result;
    };
  };
  const parse = cached(code);
  const parseCurrent =
    input.currentCode === null ? null : cached(input.currentCode, input.currentResults);

  const fail = (failure: GateFailure) => {
    evaluation.failures.push(failure);
    evaluation.failedGate ??= failure.gate;
  };
  const isExampleRow = (row: WindowScore) =>
    row.userId === example.userId && row.periodKey === example.periodKey;
  const ref = (row: WindowScore): RowRef => ({ userId: row.userId, periodKey: row.periodKey });
  const reading = (row: WindowScore) => ({ ...ref(row), readByVersion: row.codeVersion });
  const expectedOfExample = example.pick ? pickValue(example.pick) : example.value;

  // Gate 1 — sandbox limits, on the text the code was written for.
  const onExample = await parse(example.raw);
  if (hitLimit(onExample)) {
    fail({
      gate: "sandbox_limit",
      raw: example.raw,
      expected: expectedOfExample,
      actual: onExample,
    });
    return;
  }
  if (!matches(expectedOfExample, onExample)) {
    fail({
      gate: "reproduction",
      raw: example.raw,
      expected: expectedOfExample,
      actual: onExample,
      ...ref(example),
      note: "the example being taught",
    });
    return;
  }

  // Gate 2 — the alteration test, on every confirmed example whose pick is a
  // computed feature. Checking the older examples too is what stops code that
  // satisfies two conflicting picks by special-casing one of the texts.
  const others = input.window.filter((row) => row.isExample && !isExampleRow(row));
  for (const row of [example, ...others]) {
    if (row.pick?.kind === "no_result") {
      // A loss must stay a loss when only the puzzle number or date changes.
      const altered = noResultAlteration(row.raw);
      if (altered === null) continue;
      if (!isExampleRow(row) && (await parse(row.raw)).kind !== "noResult") continue;
      const actual = await parse(altered);
      if (actual.kind !== "noResult") {
        fail({
          gate: hitLimit(actual) ? "sandbox_limit" : "alteration_test",
          raw: altered,
          expected: null,
          actual,
          note: "the same loss on another day — it must still be no result",
        });
      }
      continue;
    }
    if (row.pick?.kind !== "feature") continue;
    const alterations = alterationsFor(row.raw, row.pick.feature);
    if (alterations.length === 0 && isExampleRow(row)) {
      fail({
        gate: "alteration_test",
        raw: row.raw,
        expected: row.pick.feature.value,
        actual: onExample,
        note: "this share offers nothing to alter, so the pick cannot be checked",
      });
      return;
    }
    // An older example is only held to the test while the code still
    // reproduces it; if it doesn't, that is gate 3's finding, not this one's.
    if (!isExampleRow(row) && !matches(row.pick.feature.value, await parse(row.raw))) continue;
    for (const alteration of alterations) {
      const actual = await parse(alteration.raw);
      if (hitLimit(actual)) {
        fail({ gate: "sandbox_limit", raw: alteration.raw, expected: alteration.expected, actual });
        return;
      }
      if (!matches(alteration.expected, actual)) {
        fail({
          gate: "alteration_test",
          raw: alteration.raw,
          expected: alteration.expected,
          actual,
          note: `altered copy (${alteration.how}) — the result must follow the change`,
        });
      }
    }
  }
  if (evaluation.failedGate) return;

  // Gates 3 and 4, and the rows the code may be applied to, in one pass.
  // The teacher's pick is a correction by construction: a teach only runs when
  // the current parser does not already read it.
  const correcting = new Set<string>([example.userId]);
  const conflicting = new Set<string>();
  const publish = () => {
    evaluation.correctingUsers = [...correcting];
    evaluation.conflictingUsers = [...conflicting];
  };
  for (const row of input.window) {
    if (isExampleRow(row)) continue;
    const actual = await parse(row.raw);
    if (hitLimit(actual)) {
      // Code that hits a cap on one stored share is rejected outright: don't
      // pay for the same timeout on every remaining row.
      fail({ gate: "sandbox_limit", raw: row.raw, expected: row.value, actual, ...ref(row) });
      publish();
      return;
    }
    const mine = row.userId === example.userId;

    if (row.source === "picked") {
      // A pick that is not a training example binds nobody; its row keeps its value.
      if (!row.isExample || !row.pick) continue;
      const expected = pickValue(row.pick);
      if (matches(expected, actual)) {
        // Agreement only counts toward a switch when the pick is itself a
        // correction — something the current parser does not produce.
        const current = parseCurrent ? await parseCurrent(row.raw) : null;
        if (!current || !matches(expected, current)) correcting.add(row.userId);
      } else if (mine) evaluation.overturnedPicks.push(ref(row));
      else {
        conflicting.add(row.userId);
        evaluation.conflictingPicks.push(ref(row));
        fail({
          gate: "reproduction",
          raw: row.raw,
          expected,
          actual,
          ...ref(row),
          note: "a score another player confirmed",
        });
      }
      continue;
    }

    const reads = actual.kind === "score" || actual.kind === "noResult";
    const read = await isRead(row, parseCurrent);
    if (!read) {
      if (reads) evaluation.rereads.push({ ...reading(row), result: actual });
    } else if (!storedMatches(row, actual)) {
      // The teacher's own read rows follow their correction; anyone else's hold.
      if (mine) {
        if (reads) evaluation.rereads.push({ ...reading(row), result: actual });
        continue;
      }
      if (reads) evaluation.changedReads.push({ ...reading(row), result: actual });
      fail({
        gate: "changes_other_read_scores",
        raw: row.raw,
        expected: row.status === "no_result" ? null : row.value,
        actual,
        ...ref(row),
        note: "a score that is already read",
      });
    }
  }
  publish();
}

/**
 * Whether a parsed row counts as "already read". A row with a status was read
 * by code. A row from before code-based parsing (no status) holds whatever the
 * legacy chain produced — including the first-number fallback this overhaul
 * removes — so it only counts when the game's current code reproduces it. A
 * game with no code has no read rows: it is unread until taught.
 */
async function isRead(
  row: WindowScore,
  parseCurrent: ((raw: string) => Promise<ParseResult>) | null,
): Promise<boolean> {
  if (row.status === "score" || row.status === "no_result") return true;
  if (row.status === "failed" || row.value === null || parseCurrent === null) return false;
  const current = await parseCurrent(row.raw);
  return current.kind === "score" && current.value === row.value;
}

export type TeachDecision =
  /** All four gates passed. */
  | "accept"
  /** Something read or confirmed would move, and two or more correcting users outvote it. */
  | "switch"
  /** The code contradicts another user's confirmed pick and has no majority. */
  | "conflict"
  /** Anything else: the game stays as it is. */
  | "reject";

/**
 * What to do with evaluated code. The parser changes on its own only when
 * nothing confirmed or read moves (`accept`). When something would — another
 * user's confirmed pick is contradicted, or other users' read scores change —
 * it takes a second user making a matching correction, and more correcting
 * users than contradicted ones, to `switch`. That holds against any parser,
 * confirmed by a pick or not: a seeded or operator-written parser that reads
 * the wrong thing is repaired by two players correcting it the same way.
 *
 * One correction alone never moves someone else's score: against a confirmed
 * pick it is a `conflict` (the game is flagged), otherwise a plain `reject`.
 */
export function decide(evaluation: CodeEvaluation): TeachDecision {
  // An evaluation that could not finish proves nothing either way.
  if (evaluation.noVerdict !== null) return "reject";
  if (evaluation.failedGate === null) return "accept";
  const onlyDisagreement = evaluation.failures.every(
    (f) => f.gate === "reproduction" || f.gate === "changes_other_read_scores",
  );
  // A failed example or alteration never reaches the vote.
  if (!onlyDisagreement || evaluation.correctingUsers.length === 0) return "reject";
  if (
    evaluation.correctingUsers.length >= 2 &&
    evaluation.correctingUsers.length > evaluation.conflictingUsers.length
  ) {
    return "switch";
  }
  return evaluation.conflictingUsers.length > 0 ? "conflict" : "reject";
}

function describeActual(actual: ParseResult): string {
  if (actual.kind === "score") return `returned ${actual.value}`;
  if (actual.kind === "noResult") return "returned null";
  return `failed (${actual.reason}${actual.detail ? `: ${actual.detail}` : ""})`;
}

/** The gate failures as feedback for the one retry of the write-code step. */
export function describeFailures(failures: readonly GateFailure[], limit = 3): string {
  return failures
    .slice(0, limit)
    .map((f) => {
      const want = f.expected === null ? "null" : String(f.expected);
      const note = f.note ? ` (${f.note})` : "";
      return `For this text${note} parse must return ${want} but it ${describeActual(f.actual)}:\n<<<\n${f.raw}\n>>>`;
    })
    .join("\n\n");
}
