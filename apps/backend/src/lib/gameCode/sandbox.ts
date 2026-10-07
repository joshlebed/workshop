// The QuickJS sandbox: runs one stored `parse` / `format` function over one
// share text and classifies what came back. Synchronous and in-thread — it is
// only ever called from the worker (sandboxWorker.ts), which is what gives it
// a wall-clock kill. Do not import this from request-handling code: use
// runtime.ts.
//
// The stored-code contract is documented in README.md beside this file.

import { setFlagsFromString } from "node:v8";
import variantModule from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  type Intrinsics,
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
  Scope,
} from "quickjs-emscripten-core";
import {
  FUEL_TICKS,
  MAX_CODE_CHARS,
  MAX_INPUT_CHARS,
  MAX_SCORE_MAGNITUDE,
  MAX_SUMMARY_CHARS,
  MEMORY_LIMIT_BYTES,
  STACK_LIMIT_BYTES,
} from "./limits.js";
import type {
  FormatResult,
  GameCodeFailure,
  GameCodeFailureReason,
  ParseResult,
  SandboxJob,
  SandboxJobResult,
} from "./types.js";

// The variant is a CommonJS package: under Node's ESM loader (tsx, vitest) the
// default import is the whole `module.exports`, under esbuild it is already
// unwrapped.
type Variant = Parameters<typeof newQuickJSWASMModuleFromVariant>[0];
function unwrapVariant(mod: unknown): Variant {
  const inner =
    typeof mod === "object" && mod !== null && "default" in mod
      ? (mod as { default: unknown }).default
      : mod;
  return inner as Variant;
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

/**
 * Compile + instantiate the QuickJS WASM module once per thread.
 *
 * Compiled with V8's baseline WASM compiler only (`--liftoff-only`). With the
 * default tiering, V8 recompiles hot functions with TurboFan on background
 * threads right after start; on a 512 MB Lambda (0.29 vCPU) those threads
 * starve the sandbox, and the first real job after a cold start took ~410 ms
 * against a 250 ms kill timer. Baseline-only makes it ~1.5 ms, starts the
 * worker ~40% sooner, and costs ~0.2 ms per warm run. V8 flags are
 * process-wide: this is fine because QuickJS is the only WASM the backend
 * loads. Re-run scripts/bench-game-code.mjs when the Node runtime changes —
 * if a future V8 ignores the flag, the first-job number is what regresses.
 */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    setFlagsFromString("--liftoff-only");
    modulePromise = newQuickJSWASMModuleFromVariant(unwrapVariant(variantModule));
  }
  return modulePromise;
}

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
// INTRINSICS: random numbers, and GC-observable references.
const PRELUDE = `
delete Math.random;
delete globalThis.WeakRef;
delete globalThis.FinalizationRegistry;
delete globalThis.performance;
delete globalThis.queueMicrotask;
`;

const DETAIL_MAX = 200;

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
 * under the memory, stack and instruction limits. Total: never throws for
 * anything the stored code does. A throw from here means the WASM module
 * itself misbehaved, and the caller should discard the module.
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

      const raw = scope.manage(context.newString(job.raw));
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
