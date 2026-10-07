// Host side of the game-code sandbox — the only entry point request handlers
// and scripts should use. Stored `parse` / `format` code is untrusted (written
// by an LLM from user-pasted text, or by an operator), so every run goes to a
// worker thread that executes it inside QuickJS (sandbox.ts) and is killed if
// it overruns its wall-clock budget.
//
// Nothing here throws or rejects for anything the stored code does: the worst
// outcome is `{ kind: "failed" }` within a bounded time.

import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { logger } from "../logger.js";
import {
  HARD_TIMEOUT_MS,
  MAX_CODE_CHARS,
  MAX_INPUT_CHARS,
  WORKER_STACK_MB,
  WORKER_START_TIMEOUT_MS,
} from "./limits.js";
import type {
  FormatResult,
  GameCodeFailure,
  GameCodeFailureReason,
  ParseResult,
  SandboxJob,
  SandboxJobResult,
  SandboxRequest,
  SandboxResponse,
} from "./types.js";

// Set by scripts/bundle.mjs (esbuild `define`) to the worker bundle's file
// name; undefined when running from source (tsx, vitest).
declare const __GAME_CODE_WORKER_FILE__: string | undefined;

let sourceWorkerCode: string | null = null;

/**
 * From source there is no prebuilt worker, so bundle sandboxWorker.ts in
 * memory the way scripts/bundle.mjs does — dev and tests then run the same
 * single-file CommonJS artifact the Lambda does, with no TypeScript loader
 * needed inside the thread. ~50 ms, once per process. esbuild is reached
 * through `createRequire` so the Lambda bundle never tries to include it.
 */
function buildWorkerFromSource(): string {
  if (sourceWorkerCode !== null) return sourceWorkerCode;
  const esbuild = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");
  const built = esbuild.buildSync({
    entryPoints: [fileURLToPath(new URL("./sandboxWorker.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const code = built.outputFiles[0]?.text;
  if (!code) throw new Error("game code worker build produced no output");
  sourceWorkerCode = code;
  return code;
}

function startWorker(): Worker {
  // The thread gets no environment (no DATABASE_URL, no API keys) and a small
  // V8 heap of its own. Stored code never sees either — it runs inside the
  // WASM VM with no host functions — so this is a second wall, not the first.
  const options = {
    env: {},
    resourceLimits: {
      maxOldGenerationSizeMb: 64,
      maxYoungGenerationSizeMb: 16,
      // Not a generosity: see WORKER_STACK_MB for why the default 4 MB traps.
      stackSizeMb: WORKER_STACK_MB,
    },
  };
  if (typeof __GAME_CODE_WORKER_FILE__ === "string") {
    return new Worker(join(__dirname, __GAME_CODE_WORKER_FILE__), options);
  }
  return new Worker(buildWorkerFromSource(), { ...options, eval: true });
}

interface LiveWorker {
  worker: Worker;
  ready: Promise<boolean>;
  /** Settles the job in flight, if any. */
  settle: ((result: SandboxJobResult) => void) | null;
  expectedId: number;
}

let live: LiveWorker | null = null;
let nextId = 1;
// One job at a time: the worker is single-threaded, and a per-job kill timer
// only means something if the job is the one running.
let queue: Promise<unknown> = Promise.resolve();

function failed(reason: GameCodeFailureReason, detail?: string): GameCodeFailure {
  return detail === undefined ? { kind: "failed", reason } : { kind: "failed", reason, detail };
}

function discard(target: LiveWorker, why: string): void {
  if (live === target) live = null;
  target.settle?.(failed("sandbox_unavailable", why));
  target.settle = null;
  void target.worker.terminate();
}

function ensureWorker(): LiveWorker {
  if (live) return live;
  const worker = startWorker();
  // Never keep the process (a script, a test run) alive for the sandbox.
  worker.unref();
  let markReady: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    markReady = resolve;
  });
  const created: LiveWorker = { worker, ready, settle: null, expectedId: 0 };
  const startedAt = Date.now();
  worker.on("message", (message: SandboxResponse) => {
    if (message.type === "ready") {
      // Once per process (and once per kill): the cost a cold container pays.
      logger.info("game code sandbox started", {
        kind: "game_code_sandbox_started",
        start_ms: Date.now() - startedAt,
        warm_up_ms: message.warmUpMs,
      });
      markReady(true);
      return;
    }
    if (message.id !== created.expectedId || !created.settle) return;
    const settle = created.settle;
    created.settle = null;
    // A worker that answers `sandbox_unavailable` is reporting its own death
    // (the WASM module trapped; it exits right after posting). Stop using it
    // now, or the next job would be posted to a thread that is about to exit
    // and fail for something it did not do.
    if (message.result.kind === "failed" && message.result.reason === "sandbox_unavailable") {
      discard(created, "worker lost its sandbox");
    }
    settle(message.result);
  });
  worker.on("error", (error) => {
    logger.error("game code sandbox worker error", { error });
    markReady(false);
    discard(created, "worker error");
  });
  worker.on("exit", () => {
    markReady(false);
    discard(created, "worker exited");
  });
  live = created;
  return created;
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function runOne(job: SandboxJob): Promise<SandboxJobResult> {
  let target: LiveWorker;
  try {
    target = ensureWorker();
  } catch (error) {
    logger.error("game code sandbox worker failed to start", { error });
    return failed("sandbox_unavailable", "worker failed to start");
  }
  const ready = await withTimeout(target.ready, WORKER_START_TIMEOUT_MS, () => false);
  if (!ready) {
    discard(target, "worker did not start");
    return failed("sandbox_unavailable", "worker did not start");
  }

  const id = nextId++;
  const answered = new Promise<SandboxJobResult>((resolve) => {
    target.settle = resolve;
    target.expectedId = id;
  });
  const request: SandboxRequest = { id, job };
  target.worker.postMessage(request);
  return withTimeout(answered, HARD_TIMEOUT_MS, () => {
    // Still running after the wall-clock budget: a QuickJS built-in that
    // never yields. Killing the thread is the only way to stop it; the next
    // job starts a fresh one.
    target.settle = null;
    discard(target, "killed");
    return failed("timeout", KILLED_DETAIL);
  });
}

function enqueue(job: SandboxJob): Promise<SandboxJobResult> {
  if (job.code.length > MAX_CODE_CHARS)
    return Promise.resolve(failed("too_large", "code is too long"));
  if (job.raw.length > MAX_INPUT_CHARS)
    return Promise.resolve(failed("too_large", "input is too long"));
  const result = queue.then(() => runOne(job));
  queue = result.catch(() => undefined);
  return result.catch((error: unknown) => {
    logger.error("game code sandbox failed", { error });
    return failed("sandbox_unavailable", "sandbox error");
  });
}

/**
 * Run a game's stored `parse(raw)` over one share text. Resolves — never
 * rejects. Worst case for one call is `WORKER_START_TIMEOUT_MS` +
 * `HARD_TIMEOUT_MS` = 2.25 s: a worker that never comes up, or one that
 * comes up at the last moment and then runs code that has to be killed. With
 * a warm worker the bound is `HARD_TIMEOUT_MS` (250 ms). Callers on a request
 * path should put their own, tighter cap on top (see `gameCodeService.ts`).
 */
export async function runParse(code: string, raw: string): Promise<ParseResult> {
  const result = await enqueue({ fn: "parse", code, raw });
  // `summary` / `none` only come back from format jobs.
  if (result.kind === "summary" || result.kind === "none") {
    return failed("sandbox_unavailable", "unexpected result");
  }
  return result;
}

/** Run a game's stored `format(raw)` over one share text. Same guarantees as `runParse`. */
export async function runFormat(code: string, raw: string): Promise<FormatResult> {
  const result = await enqueue({ fn: "format", code, raw });
  if (result.kind === "score" || result.kind === "noResult") {
    return failed("sandbox_unavailable", "unexpected result");
  }
  return result;
}

/** One labelled share: what `parse` (and optionally `format`) must produce on it. */
interface CodeExample {
  raw: string;
  /** The score `parse` must return; `null` = it must return "no result". */
  expected: number | null;
  /** When set, the exact summary `format` must return (`null` = it must defer). */
  expectedSummary?: string | null;
}

interface CodeMismatch {
  /** Index into the `examples` array. */
  index: number;
  step: "parse" | "format";
  raw: string;
  expected: number | string | null;
  actual: ParseResult | FormatResult;
}

interface CodeValidation {
  /** True only when every example was run and the code got all of them right. */
  ok: boolean;
  /**
   * True when the sandbox itself could not run the code (the worker failed to
   * start, or died). `ok` is then false and says NOTHING about the code:
   * `mismatches` lists only what was established before the sandbox went
   * away. Callers retry or fail soft — they must not tell anyone the code is
   * wrong.
   */
  unavailable: boolean;
  /** Examples fully checked. Less than the number given when `unavailable`. */
  checked: number;
  mismatches: CodeMismatch[];
}

// A validation run that keeps getting its worker killed is hostile or broken
// code; stop paying a thread restart per example.
const MAX_KILLS_PER_VALIDATION = 2;
const KILLED_DETAIL = "wall-clock budget exhausted";

// Failures that mean "this code can never work", whatever the input.
// `sandbox_unavailable` is deliberately not one: it is a fact about the
// sandbox, not about the code (see `CodeValidation.unavailable`).
const LOAD_FAILURES: ReadonlySet<GameCodeFailureReason> = new Set<GameCodeFailureReason>([
  "invalid_code",
  "missing_function",
  "too_large",
]);

function loads(result: ParseResult | FormatResult): boolean {
  return result.kind !== "failed" || !LOAD_FAILURES.has(result.reason);
}

function sandboxWasUnavailable(result: ParseResult | FormatResult): boolean {
  return result.kind === "failed" && result.reason === "sandbox_unavailable";
}

function wasKilled(result: ParseResult | FormatResult): boolean {
  return result.kind === "failed" && result.detail === KILLED_DETAIL;
}

function parseMatches(expected: number | null, actual: ParseResult): boolean {
  if (expected === null) return actual.kind === "noResult";
  return actual.kind === "score" && actual.value === expected;
}

function formatMatches(expected: string | null | undefined, actual: FormatResult): boolean {
  if (expected === undefined) return actual.kind !== "failed";
  if (expected === null) return actual.kind === "none";
  return actual.kind === "summary" && actual.text === expected;
}

/**
 * Check candidate code against labelled examples before it is stored. `parse`
 * must reproduce every `expected`; `format`, when given, must not fail on any
 * example and must reproduce every `expectedSummary` that is set. With no
 * examples it still proves each block loads and defines its function.
 *
 * If the sandbox itself cannot run the code, the result is
 * `{ ok: false, unavailable: true }` and validation stops there: that is not
 * a verdict on the code.
 */
export async function validateCode(
  code: { parse: string; format?: string | null },
  examples: ReadonlyArray<CodeExample>,
): Promise<CodeValidation> {
  const mismatches: CodeMismatch[] = [];
  const formatCode = code.format ?? null;
  const unavailable = (checked: number): CodeValidation => ({
    ok: false,
    unavailable: true,
    checked,
    mismatches,
  });

  if (examples.length === 0) {
    const parsed = await runParse(code.parse, "");
    if (sandboxWasUnavailable(parsed)) return unavailable(0);
    if (!loads(parsed)) {
      mismatches.push({ index: 0, step: "parse", raw: "", expected: null, actual: parsed });
    }
    const formatted = formatCode === null ? null : await runFormat(formatCode, "");
    if (formatted && sandboxWasUnavailable(formatted)) return unavailable(0);
    if (formatted && !loads(formatted)) {
      mismatches.push({ index: 0, step: "format", raw: "", expected: null, actual: formatted });
    }
    return { ok: mismatches.length === 0, unavailable: false, checked: 0, mismatches };
  }

  let kills = 0;
  for (const [index, example] of examples.entries()) {
    const { raw, expected } = example;
    if (kills >= MAX_KILLS_PER_VALIDATION) {
      const actual = failed("timeout", "validation stopped after repeated timeouts");
      mismatches.push({ index, step: "parse", raw, expected, actual });
      continue;
    }
    const parsed = await runParse(code.parse, raw);
    if (sandboxWasUnavailable(parsed)) return unavailable(index);
    if (wasKilled(parsed)) kills += 1;
    if (!parseMatches(expected, parsed)) {
      mismatches.push({ index, step: "parse", raw, expected, actual: parsed });
    }
    if (formatCode === null) continue;
    const formatted = await runFormat(formatCode, raw);
    if (sandboxWasUnavailable(formatted)) return unavailable(index);
    if (wasKilled(formatted)) kills += 1;
    if (!formatMatches(example.expectedSummary, formatted)) {
      const expectedSummary = example.expectedSummary ?? null;
      mismatches.push({ index, step: "format", raw, expected: expectedSummary, actual: formatted });
    }
  }
  return {
    ok: mismatches.length === 0,
    unavailable: false,
    checked: examples.length,
    mismatches,
  };
}

/**
 * Start the worker and load QuickJS ahead of the first job. Optional — the
 * first `runParse` does the same lazily. Resolves false if it could not start.
 *
 * Safe to call un-awaited at module init, including on Lambda: if the
 * container is frozen mid-load and the timer here fires on thaw, this only
 * resolves false. It never discards the worker, which keeps loading and is
 * picked up by the next job (each job waits on `ready` with its own timer,
 * started when the job is).
 */
export async function warmGameCodeSandbox(): Promise<boolean> {
  try {
    const target = ensureWorker();
    return await withTimeout(target.ready, WORKER_START_TIMEOUT_MS, () => false);
  } catch (error) {
    logger.error("game code sandbox worker failed to start", { error });
    return false;
  }
}

/** Stop the worker thread (tests, scripts that want a prompt exit). */
export async function shutdownGameCodeSandbox(): Promise<void> {
  const target = live;
  live = null;
  if (!target) return;
  target.settle?.(failed("sandbox_unavailable", "sandbox shut down"));
  target.settle = null;
  await target.worker.terminate();
}
