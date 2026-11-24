// The game-code sandbox's core: run one stored `parse` / `format` function over
// one share text inside QuickJS and classify what came back. This is the one
// code path that reads a score out of a share, and two hosts run it:
//
//   - the backend (`apps/backend/src/lib/gameCode/`), on the WASM build of
//     QuickJS inside a worker thread it can kill — the reading that is stored;
//   - the HighScore client, on the plain-JS build of the same QuickJS version
//     (Hermes has no WebAssembly), for an instant reading in the share flow.
//
// `runJob` takes whichever QuickJS module its host loaded, so the limits, the
// language surface and the classification cannot differ between the two. What
// differs is only what is around it: the server has a 250 ms wall clock
// (worker kill); a phone does not, which is why only reviewed code is sent to
// clients (see `loadGameRecognizers`).
//
// The stored-code contract is documented in the backend's
// `lib/gameCode/README.md`. A client-imported subpath: it must not
// value-import a sibling module, so the limits and types it needs live here.

import {
  type Intrinsics,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
  Scope,
} from "quickjs-emscripten-core";

// ---------------------------------------------------------------------------
// Limits. Every number here is a cap on untrusted code, so raising one is a
// security decision — re-run the backend's sandbox.test.ts and the latency
// benchmark (apps/backend/scripts/bench-game-code.mjs) before changing any.
// ---------------------------------------------------------------------------

/** Longest `parse_code` / `format_code` accepted, in UTF-16 code units. */
export const MAX_CODE_CHARS = 16_000;

/** Longest share text handed to the code. The API caps a score at 2000. */
export const MAX_INPUT_CHARS = 4_000;

/** Longest summary `format` may return. */
export const MAX_SUMMARY_CHARS = 2_000;

/** Largest score magnitude accepted from `parse`; beyond it is junk. */
const MAX_SCORE_MAGNITUDE = 1e12;

/**
 * QuickJS heap cap per run. A fresh context uses ~53 KB, so this is ~40x what
 * a parser needs. Kept low on purpose: QuickJS garbage-collects harder as it
 * nears the cap, so an allocation bomb takes ~40-180 ms to fail at 2 MB and
 * ~150-550 ms at 8 MB.
 */
export const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * QuickJS stack cap per run — deep recursion fails as a thrown error
 * (`InternalError: stack overflow`), not a crash.
 *
 * This cap only measures QuickJS's own stack in WASM linear memory. Each
 * WASM call also takes a frame on the worker thread's NATIVE stack, which
 * QuickJS cannot see, and some of its recursive routines use a lot of native
 * stack per level and almost none of the measured kind: the source parser
 * (nested parentheses, array and object literals) and `JSON.parse`. If the
 * native stack runs out first, the WASM module traps and the worker has to be
 * restarted (~75–700 ms) — a cost a hostile code author could trigger on
 * every post. So the two limits are sized together: see `WORKER_STACK_MB` in
 * the backend's `lib/gameCode/limits.ts`.
 */
const STACK_LIMIT_BYTES = 256 * 1024;

/**
 * Instruction budget per run, in QuickJS interrupt ticks (one tick per ~10k
 * loop iterations / calls / regex backtracks). 200 ticks is ~10 ms of a tight
 * loop (8–13 ms measured) and thousands of times what a real parser uses. It is
 * a count, not a clock, so the same code on the same input always gets the
 * same verdict however busy the host is.
 */
export const FUEL_TICKS = 200;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

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
  | "sandbox_unavailable"
  /** The game has no code to run — nobody has taught it yet. */
  | "no_code";

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

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

// Language features the code gets. No Date (nondeterministic), no Proxy /
// typed arrays / BigInt (a parser has no use for them and each is more
// surface). `Eval` is what `evalCode` itself needs. Promise stays on only
// because QuickJS aborts when an `async function` is called without it; the
// job queue is never run, so a returned promise is just a bad return value.
const INTRINSICS: Intrinsics = {
  BaseObjects: true,
  Eval: true,
  StringNormalize: true,
  RegExp: true,
  RegExpCompiler: true,
  JSON: true,
  MapSet: true,
  Promise: true,
  Date: false,
  Proxy: false,
  TypedArrays: false,
  BigInt: false,
};

// Runs before the stored code. Removes what is left of nondeterminism after
// INTRINSICS (random numbers, GC-observable references), and every way to
// compile code at run time: `eval`, and the four function constructors
// reachable through `(function () {}).constructor` and its generator / async
// siblings. Stored code has no use for them, and they are how a program would
// hand QuickJS's parser source nested deeper than the code-size cap allows —
// see STACK_LIMIT_BYTES in limits.ts for why that depth has to be bounded.
// (`evalCode` on the host side does not go through the `eval` global.)
const PRELUDE = `
delete Math.random;
delete globalThis.WeakRef;
delete globalThis.FinalizationRegistry;
delete globalThis.performance;
delete globalThis.queueMicrotask;
[
  Function.prototype,
  Object.getPrototypeOf(function* () {}),
  Object.getPrototypeOf(async function () {}),
  Object.getPrototypeOf(async function* () {}),
].forEach(function (proto) { delete proto.constructor; });
delete globalThis.eval;
delete globalThis.Function;
`;

const DETAIL_MAX = 200;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Replace lone surrogates with U+FFFD before text enters the VM. The string
 * crosses into WASM as UTF-8, which cannot carry half a surrogate pair: left
 * alone, one arrives intact in some positions and swallows the rest of the
 * text in others (`"x\uDFC6\uD83Cy"` reached the code as two characters).
 * A well-formed string is the only input the code can read predictably — and
 * Postgres would not have stored the lone surrogate either.
 */
function toWellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "\uFFFD");
}

function failed(reason: GameCodeFailureReason, detail?: string): GameCodeFailure {
  return detail === undefined
    ? { kind: "failed", reason }
    : { kind: "failed", reason, detail: detail.slice(0, DETAIL_MAX) };
}

interface Budget {
  exhausted: boolean;
}

/** Read `name: message` off a thrown value without trusting its shape. */
function describeThrown(context: QuickJSContext, thrown: QuickJSHandle): string {
  try {
    return Scope.withScope((scope) => {
      if (context.typeof(thrown) === "string") return context.getString(thrown);
      if (context.typeof(thrown) !== "object") return "non-error value thrown";
      const name = scope.manage(context.getProp(thrown, "name"));
      const message = scope.manage(context.getProp(thrown, "message"));
      const parts = [name, message]
        .filter((h) => context.typeof(h) === "string")
        .map((h) => context.getString(h));
      return parts.length > 0 ? parts.join(": ") : "non-error value thrown";
    });
  } catch {
    return "unreadable error";
  }
}

function classifyThrown(
  context: QuickJSContext,
  thrown: QuickJSHandle,
  budget: Budget,
  whenThrown: GameCodeFailureReason,
): GameCodeFailure {
  if (budget.exhausted) return failed("timeout", "instruction budget exhausted");
  const detail = describeThrown(context, thrown);
  // Reading the error can run a getter, which can burn the rest of the budget.
  if (budget.exhausted) return failed("timeout", "instruction budget exhausted");
  if (detail === "InternalError: out of memory") return failed("out_of_memory");
  return failed(whenThrown, detail);
}

function readParse(context: QuickJSContext, value: QuickJSHandle): ParseResult {
  const type = context.typeof(value);
  if (type === "number") {
    const n = context.getNumber(value);
    if (!Number.isFinite(n)) return failed("bad_return", `parse returned ${String(n)}`);
    if (Math.abs(n) > MAX_SCORE_MAGNITUDE)
      return failed("bad_return", "parse returned a number out of range");
    // `-0` would round-trip through numeric storage as "0" anyway.
    return { kind: "score", value: n === 0 ? 0 : n };
  }
  if (context.sameValue(value, context.null)) return { kind: "noResult" };
  return failed("bad_return", `parse returned ${type}`);
}

function readFormat(context: QuickJSContext, value: QuickJSHandle): FormatResult {
  const type = context.typeof(value);
  if (type === "string") {
    // Check the length inside the VM before copying the string out of it.
    // (`length` of a primitive string runs no stored code.)
    const length = Scope.withScope((scope) =>
      context.getNumber(scope.manage(context.getProp(value, "length"))),
    );
    if (!(length <= MAX_SUMMARY_CHARS)) {
      return failed("too_large", "format returned too long a string");
    }
    const text = context.getString(value);
    return text.trim().length > 0 ? { kind: "summary", text } : { kind: "none" };
  }
  if (context.sameValue(value, context.null)) return { kind: "none" };
  return failed("bad_return", `format returned ${type}`);
}

/**
 * Run one job in a fresh runtime + context (nothing survives between runs),
 * under the memory, stack and instruction limits. Synchronous, and total:
 * never throws for anything the stored code does. A throw from here means the
 * QuickJS module itself misbehaved, and the caller should discard the module.
 *
 * It has no wall clock of its own. A QuickJS built-in runs to completion
 * without ticking the instruction budget, so a host that runs untrusted code
 * must be able to stop the thread (the backend's worker), and a host that
 * cannot must only be given code someone reviewed.
 */
export function runJob(quickjs: QuickJSWASMModule, job: SandboxJob): SandboxJobResult {
  if (job.code.length > MAX_CODE_CHARS) return failed("too_large", "code is too long");
  if (job.raw.length > MAX_INPUT_CHARS) return failed("too_large", "input is too long");

  const runtime = quickjs.newRuntime();
  let fuel = FUEL_TICKS;
  const budget: Budget = { exhausted: false };
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);
  runtime.setInterruptHandler(() => {
    fuel -= 1;
    if (fuel < 0) budget.exhausted = true;
    return budget.exhausted;
  });
  const context = runtime.newContext({ intrinsics: INTRINSICS });
  try {
    return Scope.withScope((scope): SandboxJobResult => {
      const prelude = context.evalCode(PRELUDE, "prelude.js");
      if (prelude.error) {
        prelude.error.dispose();
        throw new Error("game code sandbox prelude failed");
      }
      prelude.value.dispose();

      const loaded = context.evalCode(job.code, `${job.fn}.js`, { type: "global" });
      if (loaded.error) {
        return classifyThrown(context, scope.manage(loaded.error), budget, "invalid_code");
      }
      loaded.value.dispose();

      // `typeof` finds a top-level `function parse` and a `const parse = …` alike.
      const lookup = context.evalCode(
        `typeof ${job.fn} === "function" ? ${job.fn} : undefined`,
        "lookup.js",
      );
      if (lookup.error) {
        return classifyThrown(context, scope.manage(lookup.error), budget, "missing_function");
      }
      const fn = scope.manage(lookup.value);
      if (context.typeof(fn) !== "function") {
        return failed("missing_function", `code does not define ${job.fn}(raw)`);
      }

      const raw = scope.manage(context.newString(toWellFormed(job.raw)));
      const called = context.callFunction(fn, context.undefined, raw);
      if (called.error) {
        return classifyThrown(context, scope.manage(called.error), budget, "threw");
      }
      const value = scope.manage(called.value);
      return job.fn === "parse" ? readParse(context, value) : readFormat(context, value);
    });
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
