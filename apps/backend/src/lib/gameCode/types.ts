// Types shared by the sandbox (worker side) and the runtime (host side).
// Type-only on purpose: the worker bundle and the Lambda bundle both import
// this file, and neither should drag the other's code in.

/** Why a run produced no usable result. Stable strings: they are logged and stored. */
export type GameCodeFailureReason =
  /** The code has a syntax error or threw while being loaded. */
  | "invalid_code"
  /** The code loaded but does not define the function that was called. */
  | "missing_function"
  /** The function threw (including a stack overflow). */
  | "threw"
  /** The function ran out of its instruction budget or was killed on wall time. */
  | "timeout"
  /** The function hit the memory cap. */
  | "out_of_memory"
  /** The function returned something the contract does not allow. */
  | "bad_return"
  /** The code, the input or the output was over its size cap. */
  | "too_large"
  /** The sandbox itself could not run the code (worker failed to start, crashed). */
  | "sandbox_unavailable";

export interface GameCodeFailure {
  kind: "failed";
  reason: GameCodeFailureReason;
  /** Short human detail (an error message, a type name). Never the raw input. */
  detail?: string;
}

/**
 * What `parse(raw)` produced. The three kinds stay distinct all the way to
 * storage: a number, a deliberate "this share has no result" (a loss), and a
 * failure (the code could not read the text at all).
 */
export type ParseResult = { kind: "score"; value: number } | { kind: "noResult" } | GameCodeFailure;

/**
 * What `format(raw)` produced: a summary to show, a deliberate "nothing to
 * add" (`none` — callers show the cleaned-text fallback), or a failure
 * (callers show the same fallback, and the failure is worth logging).
 */
export type FormatResult = { kind: "summary"; text: string } | { kind: "none" } | GameCodeFailure;

type GameCodeFunction = "parse" | "format";

export interface SandboxJob {
  fn: GameCodeFunction;
  code: string;
  raw: string;
}

export type SandboxJobResult = ParseResult | FormatResult;

/** Host → worker. */
export interface SandboxRequest {
  id: number;
  job: SandboxJob;
}

/**
 * Worker → host. `ready` is sent once, after the WASM module has loaded and
 * the warm-up jobs have run; `warmUpMs` is how long those took (logged, so a
 * slow sandbox start is visible in prod).
 */
export type SandboxResponse =
  | { type: "ready"; warmUpMs: number }
  | { type: "result"; id: number; result: SandboxJobResult };
