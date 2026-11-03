#!/usr/bin/env node
// Duration-balanced test sharding for CI.
//
// `vitest --shard=K/N` splits the file list by *count*, so one shard inherits
// the 9s QuickJS parity file plus a run of PGlite-backed route tests while
// another gets forty 20ms pure-function files. This assigns files to N shards
// greedily by weight (longest-processing-time first) and prints the files for
// shard K, one per line, for `vitest run $(...)`.
//
// Weights come from scripts/test-weights.json (ms per file; regenerate with
// `node scripts/ci-test-shards.mjs --regen` after a local `vitest run`, which
// reads vitest's own per-file duration cache). A file missing from the map
// gets a default so new tests are never dropped — the glob here is the source
// of truth for *which* files run, the map only orders them.
//
//   node scripts/ci-test-shards.mjs <K> <N>        # list files for shard K of N
//   node scripts/ci-test-shards.mjs --plan <N>     # show every shard + its weight
//   node scripts/ci-test-shards.mjs --regen        # refresh test-weights.json from the last run
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const weightsPath = join(root, "scripts/test-weights.json");
const DEFAULT_MS = 300;

// Plain readdir rather than fs.globSync (still experimental).
function testFiles(dir = "") {
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist")
      continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...testFiles(rel));
    else if (entry.name.endsWith(".test.ts")) out.push(rel);
  }
  return out.sort();
}

function loadWeights() {
  try {
    return JSON.parse(readFileSync(weightsPath, "utf8"));
  } catch {
    return {};
  }
}

function plan(n) {
  const weights = loadWeights();
  const files = testFiles().map((f) => ({ f, w: weights[f] ?? DEFAULT_MS }));
  files.sort((a, b) => b.w - a.w || a.f.localeCompare(b.f));
  const shards = Array.from({ length: n }, () => ({ files: [], w: 0 }));
  for (const file of files) {
    const target = shards.reduce((min, s) => (s.w < min.w ? s : min), shards[0]);
    target.files.push(file.f);
    target.w += file.w;
  }
  return shards;
}

const args = process.argv.slice(2);
if (args[0] === "--regen") {
  // vitest's own sequencing cache: full per-file wall time including
  // beforeAll (where the PGlite boot lives), unlike the JSON reporter.
  // Run the suite first (ideally pinned to 4 cores: `taskset -c 0-3`).
  const cacheFile = readdirSync(join(root, "node_modules/.vite/vitest"), { recursive: true })
    .map(String)
    .find((f) => f.endsWith("results.json"));
  if (!cacheFile)
    throw new Error("no node_modules/.vite/vitest/**/results.json — run vitest first");
  const cache = JSON.parse(
    readFileSync(join(root, "node_modules/.vite/vitest", cacheFile), "utf8"),
  );
  const measured = new Map(
    cache.results.map(([k, v]) => [
      k.includes(":") ? k.slice(k.indexOf(":") + 1) : k,
      Math.round(v.duration),
    ]),
  );
  const out = {};
  for (const f of testFiles()) out[f] = measured.get(f) ?? DEFAULT_MS;
  writeFileSync(weightsPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${Object.keys(out).length} weights (${measured.size} measured)`);
} else if (args[0] === "--plan") {
  const n = Number(args[1] ?? 8);
  plan(n).forEach((s, i) => {
    console.log(`shard ${i + 1}/${n}: ${s.w}ms, ${s.files.length} files`);
  });
} else {
  const k = Number(args[0]);
  const n = Number(args[1]);
  if (!(k >= 1 && k <= n)) {
    console.error("usage: ci-test-shards.mjs <K> <N> | --plan <N> | --regen <report.json>");
    process.exit(2);
  }
  const shard = plan(n)[k - 1];
  if (shard.files.length === 0) process.exit(0);
  console.log(shard.files.join("\n"));
}
