// The QuickJS sandbox on the server: loads the WASM build of QuickJS for the
// shared `runJob` (`@workshop/shared/gameCodeSandbox` — the HighScore client
// runs the same function on the plain-JS build). Synchronous and in-thread —
// here it is only ever called from the worker (sandboxWorker.ts), which is
// what gives it a wall-clock kill. Do not import this from request-handling
// code: use runtime.ts.
//
// The stored-code contract is documented in README.md beside this file.

import { setFlagsFromString } from "node:v8";
import variantModule from "@jitl/quickjs-singlefile-cjs-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";

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
 * worker ~40% sooner, and costs ~0.2 ms per warm run.
 *
 * Node documents `v8.setFlagsFromString` after VM start as "may result in
 * unpredictable behavior … or it may simply do nothing". Why it is acceptable
 * here:
 * - The flag is only read when a WASM module is compiled, and nothing in the
 *   process has compiled one yet — this runs immediately before the first
 *   compile. It changes no state that already exists (unlike heap or GC
 *   flags, which is what that warning is about).
 * - It is process-wide, and QuickJS is the only WASM the backend loads.
 * - "Does nothing" is a safe failure: the sandbox is just slower to settle
 *   after a cold start, and that is visible — `warm_up_ms` on the
 *   `game_code_sandbox_started` log line, and the first-job row of
 *   scripts/bench-game-code.mjs. Measured effective on Node 20.20 and 22.19;
 *   re-run the benchmark when the Node runtime changes.
 * It lives here rather than at the worker's startup so that no code path can
 * compile the module without it.
 */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    setFlagsFromString("--liftoff-only");
    modulePromise = newQuickJSWASMModuleFromVariant(unwrapVariant(variantModule));
  }
  return modulePromise;
}

export { runJob } from "@workshop/shared/gameCodeSandbox";
