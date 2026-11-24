// Types shared by the sandbox (worker side) and the runtime (host side).
// Type-only on purpose: the worker bundle and the Lambda bundle both import
// this file, and neither should drag the other's code in.

import type { SandboxJob, SandboxJobResult } from "@workshop/shared/gameCodeSandbox";

export type {
  FormatResult,
  GameCodeFailure,
  GameCodeFailureReason,
  ParseResult,
  SandboxJob,
  SandboxJobResult,
} from "@workshop/shared/gameCodeSandbox";

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
