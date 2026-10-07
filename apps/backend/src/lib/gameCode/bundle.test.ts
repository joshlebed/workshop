// Proves the Lambda build ships a working sandbox: runs the real bundler
// (scripts/bundle.mjs) into a temp directory outside the repo — where no
// node_modules can be resolved — and executes a job in the worker file it
// produced. If the QuickJS WASM were not embedded, the worker would not start.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SandboxRequest, SandboxResponse } from "./types.js";

const backendRoot = resolve(__dirname, "../../..");
let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "workshop-bundle-"));
  execFileSync(
    process.execPath,
    [join(backendRoot, "scripts/bundle.mjs"), `--out-dir=${outDir}`, "--no-zip"],
    { cwd: backendRoot, stdio: "pipe" },
  );
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("Lambda bundle", () => {
  it("emits the handler and a self-contained sandbox worker", () => {
    expect(existsSync(join(outDir, "lambda.js"))).toBe(true);
    const workerPath = join(outDir, "gameCodeWorker.cjs");
    const worker = readFileSync(workerPath, "utf8");
    // The QuickJS binary (~500 KB) is inlined as a string, so there is no
    // .wasm file to ship and nothing left to resolve from node_modules.
    expect(statSync(workerPath).size).toBeGreaterThan(500_000);
    expect(readdirSync(outDir).filter((f) => f.endsWith(".wasm"))).toEqual([]);
    expect(worker).not.toMatch(/require\(["']quickjs-emscripten-core["']\)/);
    expect(worker).not.toMatch(/require\(["']@jitl\//);
  });

  it("runs a parse job in the bundled worker", async () => {
    const worker = new Worker(join(outDir, "gameCodeWorker.cjs"), { env: {} });
    try {
      const result = await new Promise<SandboxResponse>((resolvePromise, reject) => {
        worker.on("error", reject);
        worker.on("message", (message: SandboxResponse) => {
          if (message.type === "ready") {
            const request: SandboxRequest = {
              id: 1,
              job: {
                fn: "parse",
                code: `function parse(raw) { return raw.split("🏆").length - 1; }`,
                raw: "🏆❌🏆",
              },
            };
            worker.postMessage(request);
            return;
          }
          resolvePromise(message);
        });
      });
      expect(result).toEqual({ type: "result", id: 1, result: { kind: "score", value: 2 } });
    } finally {
      await worker.terminate();
    }
  }, 30_000);
});
