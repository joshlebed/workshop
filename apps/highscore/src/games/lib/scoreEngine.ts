// QuickJS on the device: the engine that runs a game's stored parse code so the
// share flow can show the score with no request. It is the plain-JS build of
// the QuickJS version the server runs as WASM (Hermes has no WebAssembly), and
// the run itself is the server's `runJob` from `@workshop/shared/gameCodeSandbox`
// — same limits, same language surface, same classification. Keep the two
// `@jitl/quickjs-*` packages and `quickjs-emscripten-core` on one version.
//
// Loaded lazily (the build is ~1.1 MB of JS; requiring it is what costs, and
// only a share needs it): ~11 ms to start and ~6 ms a parse under Hermes.
// There is no wall clock here — nothing can stop a run mid-flight — which is
// why the server only sends parse code a person reviewed.

import { type ParseResult, runJob } from "@workshop/shared/gameCodeSandbox";
import type { newQuickJSWASMModuleFromVariant, QuickJSWASMModule } from "quickjs-emscripten-core";

type Variant = Parameters<typeof newQuickJSWASMModuleFromVariant>[0];

let loading: Promise<QuickJSWASMModule | null> | null = null;
let engine: QuickJSWASMModule | null = null;

/** The engine when it has already started; null before, and if it could not. */
export function scoreEngineIfLoaded(): QuickJSWASMModule | null {
  return engine;
}

/**
 * Start the engine (once) and resolve with it — or with null when it cannot
 * start, in which case the server's reading is simply the only one. Never
 * rejects.
 */
export function loadScoreEngine(): Promise<QuickJSWASMModule | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const core = require("quickjs-emscripten-core") as typeof import("quickjs-emscripten-core");
        const variant = (require("@jitl/quickjs-asmjs-mjs-release-sync") as { default: Variant })
          .default;
        engine = await core.newQuickJSWASMModuleFromVariant(variant);
      } catch {
        engine = null;
      }
      return engine;
    })();
  }
  return loading;
}

/**
 * Run a game's parse code over a share text. Null when the engine itself
 * failed (as opposed to the code, whose failures are a `ParseResult`).
 */
export function parseOnDevice(
  quickjs: QuickJSWASMModule,
  code: string,
  raw: string,
): ParseResult | null {
  try {
    return runJob(quickjs, { fn: "parse", code, raw }) as ParseResult;
  } catch {
    return null;
  }
}
