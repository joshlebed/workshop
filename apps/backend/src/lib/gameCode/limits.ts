// Hard limits on stored game code. Every number here is a cap on untrusted
// code, so raising one is a security decision — re-run sandbox.test.ts and
// the latency benchmark (scripts/bench-game-code.mjs) before changing any.
//
// The caps a run itself enforces live beside `runJob` in
// `@workshop/shared/gameCodeSandbox` (the HighScore client runs it too); the
// ones below exist only because the server runs it in a worker thread.

export {
  FUEL_TICKS,
  MAX_CODE_CHARS,
  MAX_INPUT_CHARS,
  MAX_SUMMARY_CHARS,
  MEMORY_LIMIT_BYTES,
} from "@workshop/shared/gameCodeSandbox";

/**
 * Native stack of the worker thread. Sized so QuickJS's own check
 * (`STACK_LIMIT_BYTES`) always trips first. Measured with code at the
 * 16,000-char cap nested as deeply as it can be: 4 MB (Node's default) traps
 * on nested parentheses, arrays and object literals; 16 MB reports every
 * pattern cleanly; 64 MB is 4x that. It is address space, not memory — only
 * touched pages are committed. This holds only because stored code cannot
 * compile more source at run time (no `eval`, no `Function` constructor —
 * see the prelude in `@workshop/shared/gameCodeSandbox`), so nesting depth is bounded by
 * `MAX_CODE_CHARS`. Raising that cap means re-measuring this one.
 */
export const WORKER_STACK_MB = 64;

/**
 * Wall-clock ceiling on one run, enforced by killing the worker thread. It
 * exists for what the instruction budget cannot see: QuickJS built-ins
 * (`String.prototype.indexOf`, `repeat`, …) run to completion without
 * yielding. Looser than the fuel budget because a 512 MB Lambda gets a
 * fraction of a vCPU and a healthy run can be descheduled for tens of ms.
 */
export const HARD_TIMEOUT_MS = 250;

/** How long a cold worker (thread start + WASM compile) may take to come up. */
export const WORKER_START_TIMEOUT_MS = 2_000;
