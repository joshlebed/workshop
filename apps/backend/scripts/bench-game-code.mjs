#!/usr/bin/env node
// Latency benchmark for the game-code sandbox, run against the built worker
// (dist/gameCodeWorker.cjs) so it measures what the Lambda runs.
//
//   pnpm --filter @workshop/backend run build
//   node apps/backend/scripts/bench-game-code.mjs [--dist=<dir>] [--jobs=2000]
//
// To approximate the 512 MB Lambda (a fraction of a vCPU, Node 20):
//
//   docker run --rm --cpus=0.29 --memory=512m -v "$PWD/apps/backend:/app:ro" \
//     --entrypoint node public.ecr.aws/lambda/nodejs:20 /app/scripts/bench-game-code.mjs --dist=/app/dist
//
// Re-run after changing anything in src/lib/gameCode/limits.ts.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const here = dirname(fileURLToPath(import.meta.url));
const flags = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);
const workerFile = resolve(flags.get("dist") || resolve(here, "../dist"), "gameCodeWorker.cjs");
const JOBS = Number(flags.get("jobs") || 2000);
const COLD_STARTS = Number(flags.get("cold") || 10);

const PARSE = `function parse(raw) {
  var m = raw.match(/Wordle\\s+[\\d,]+\\s+(\\d|X)\\/6/i);
  if (!m) throw new Error("not a Wordle share");
  return m[1].toUpperCase() === "X" ? null : Number(m[1]);
}`;
const FORMAT = `function format(raw) {
  var rows = raw.split(/\\r?\\n/).map(function (l) { return l.trim(); })
    .filter(function (l) { return /^[\\u2B1B\\u2B1C\\uD83D\\uDFE8\\uD83D\\uDFE9]+$/.test(l); });
  return rows.length ? rows.join("\\n") : null;
}`;
const RAW = "Wordle 1,127 4/6\n\n⬛🟨⬛⬛⬛\n⬛⬛🟨🟩⬛\n🟩⬛🟩🟩⬛\n🟩🟩🟩🟩🟩";

function startWorker() {
  const startedAt = performance.now();
  const worker = new Worker(workerFile, { env: {} });
  let nextId = 1;
  const waiting = new Map();
  const ready = new Promise((resolveReady, reject) => {
    worker.on("error", reject);
    worker.on("message", (message) => {
      if (message.type === "ready") return resolveReady(performance.now() - startedAt);
      waiting.get(message.id)?.(message.result);
      waiting.delete(message.id);
    });
  });
  const run = (job) =>
    new Promise((resolveJob) => {
      const id = nextId++;
      waiting.set(id, resolveJob);
      worker.postMessage({ id, job });
    });
  return { worker, ready, run };
}

async function timeJob(run, job) {
  const startedAt = performance.now();
  const result = await run(job);
  return { ms: performance.now() - startedAt, result };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const f = (n) => n.toFixed(2).padStart(8);
  return `p50 ${f(at(0.5))}  p95 ${f(at(0.95))}  p99 ${f(at(0.99))}  max ${f(sorted[sorted.length - 1])} ms  (n=${sorted.length})`;
}

console.log(`node ${process.version}, worker ${workerFile}`);

// Cold: a new thread each time — thread start, script parse, WASM compile.
const coldReady = [];
const coldFirstJob = [];
for (let i = 0; i < COLD_STARTS; i++) {
  const w = startWorker();
  coldReady.push(await w.ready);
  coldFirstJob.push((await timeJob(w.run, { fn: "parse", code: PARSE, raw: RAW })).ms);
  await w.worker.terminate();
}
console.log(`worker cold start     ${summarize(coldReady)}`);
console.log(`first job after start ${summarize(coldFirstJob)}`);

// Warm: one thread, a fresh QuickJS runtime + context per job.
const w = startWorker();
await w.ready;
const parse = [];
const format = [];
for (let i = 0; i < JOBS; i++) {
  parse.push((await timeJob(w.run, { fn: "parse", code: PARSE, raw: RAW })).ms);
  format.push((await timeJob(w.run, { fn: "format", code: FORMAT, raw: RAW })).ms);
}
console.log(`warm parse            ${summarize(parse)}`);
console.log(`warm format           ${summarize(format)}`);

// Worst cases the in-VM limits stop on their own (no thread kill needed).
for (const [label, body] of [
  ["infinite loop (fuel)", "for (;;) {}"],
  ["regex backtracking  ", `return /(a+)+$/.test("a".repeat(40) + "!") ? 1 : 0;`],
  ["allocation bomb     ", "var a = []; for (;;) a.push([1, 2, 3, 4, 5, 6, 7, 8]);"],
  ["string concat bomb  ", "var a = []; for (;;) a.push(raw + a.length);"],
]) {
  const samples = [];
  let last;
  for (let i = 0; i < 5; i++) {
    const { ms, result } = await timeJob(w.run, {
      fn: "parse",
      code: `function parse(raw) { ${body} }`,
      raw: "x".repeat(2000),
    });
    samples.push(ms);
    last = result;
  }
  console.log(`${label}  ${summarize(samples)}  → ${last.reason}`);
}
await w.worker.terminate();
