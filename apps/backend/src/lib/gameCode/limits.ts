// Hard limits on stored game code. Every number here is a cap on untrusted
// code, so raising one is a security decision — re-run sandbox.test.ts and
// the latency benchmark (scripts/bench-game-code.mjs) before changing any.

/** Longest `parse_code` / `format_code` accepted, in UTF-16 code units. */
export const MAX_CODE_CHARS = 16_000;

/** Longest share text handed to the code. The API caps a score at 2000. */
export const MAX_INPUT_CHARS = 4_000;

/** Longest summary `format` may return. */
export const MAX_SUMMARY_CHARS = 2_000;

/** Largest score magnitude accepted from `parse`; beyond it is junk. */
export const MAX_SCORE_MAGNITUDE = 1e12;

/**
 * QuickJS heap cap per run. A fresh context uses ~53 KB, so this is ~40x what
 * a parser needs. Kept low on purpose: QuickJS garbage-collects harder as it
 * nears the cap, so an allocation bomb takes ~40-180 ms to fail at 2 MB and
 * ~150-550 ms at 8 MB.
 */
export const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024;

/** QuickJS stack cap per run — deep recursion fails as a thrown error. */
export const STACK_LIMIT_BYTES = 256 * 1024;

/**
 * Instruction budget per run, in QuickJS interrupt ticks (one tick per ~10k
 * loop iterations / calls / regex backtracks). 200 ticks is ~15 ms of a tight
 * loop on a dev machine and thousands of times what a real parser uses. It is
 * a count, not a clock, so the same code on the same input always gets the
 * same verdict however busy the host is.
 */
export const FUEL_TICKS = 200;

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
