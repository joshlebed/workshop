// Worker-thread entry for the game-code sandbox. One long-lived thread per
// process holds the QuickJS WASM module and answers one job at a time; the
// host (runtime.ts) kills the whole thread when a job overruns its wall-clock
// budget, which is the only way to stop a QuickJS built-in mid-flight.
//
// Bundled separately by scripts/bundle.mjs into dist/gameCodeWorker.cjs.

import { parentPort } from "node:worker_threads";
import { loadQuickJS, runJob } from "./sandbox.js";
import type { SandboxRequest, SandboxResponse } from "./types.js";

const port = parentPort;
if (!port) throw new Error("sandboxWorker must be started as a worker thread");

function post(message: SandboxResponse): void {
  port?.postMessage(message);
}

const WARM_UP_RAW = "Warm #12 3/6 (1,234 pts) 0:42\n\n🟩🟨⬛ = 5\r\nhttps://example.com/x\n#tag";
const WARM_UP_CODE = String.raw`
function lines(raw) {
  return raw.replace(/\bhttps?:\/\/\S+/gi, "").split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0 && !/^#\S+$/.test(l); });
}
function parse(raw) {
  var m = raw.match(/#(\d+)\s+(\d+|X)\/6/i);
  var points = Number((raw.match(/([\d,]+)\s*pts/) || ["", "0"])[1].replace(/,/g, ""));
  var squares = (raw.match(/🟩/gu) || []).length + raw.split("🟨").length - 1;
  var seen = new Map();
  [...raw].forEach(function (c) { seen.set(c, (seen.get(c) || 0) + 1); });
  try { null.x; } catch (e) { points += String(e.message).length; }
  if (!m || points + squares + seen.size === 0) return null;
  return m[2].toUpperCase() === "X" ? null : Number(m[2]);
}
function format(raw) {
  var grid = lines(raw).filter(function (l) { return !/[A-Za-z0-9]/.test(l.replace(/=\s*\d+.*$/, "")); });
  return JSON.parse(JSON.stringify(grid)).join("\n").normalize("NFC").toUpperCase().slice(0, 100) || null;
}
`;

void loadQuickJS().then((quickjs) => {
  // V8 compiles each WASM function on first use, so the first run through a
  // QuickJS code path (regex compile, string ops, the error path) is slower
  // than the rest. Walk the paths real parsers use here, under the start
  // timeout, instead of inside the first real job's budget.
  const warmUpStartedAt = performance.now();
  for (const fn of ["parse", "format"] as const) {
    runJob(quickjs, { fn, code: WARM_UP_CODE, raw: WARM_UP_RAW });
  }
  const warmUpMs = Math.round(performance.now() - warmUpStartedAt);
  port.on("message", (request: SandboxRequest) => {
    try {
      post({ type: "result", id: request.id, result: runJob(quickjs, request.job) });
    } catch (error) {
      // runJob only throws when the WASM module itself has gone wrong (an
      // engine assertion, a trap). Its memory can't be trusted after that:
      // answer, then exit so the host starts a clean thread.
      post({
        type: "result",
        id: request.id,
        result: {
          kind: "failed",
          reason: "sandbox_unavailable",
          detail: error instanceof Error ? error.message.slice(0, 200) : "sandbox error",
        },
      });
      process.exit(1);
    }
  });
  post({ type: "ready", warmUpMs });
});
