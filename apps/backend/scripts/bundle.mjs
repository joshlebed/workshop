#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// The game-code sandbox runs in a worker thread (src/lib/gameCode), which
// needs its own entry file next to the handler. The QuickJS WASM binary is
// embedded in the JS (the "singlefile" variant), so this one file is the whole
// sandbox — nothing else to copy into the zip.
const GAME_CODE_WORKER_FILE = "gameCodeWorker.cjs";

// `--out-dir=<dir>` builds somewhere other than dist/ and `--no-zip` skips
// lambda.zip — the bundle test (src/lib/gameCode/bundle.test.ts) uses both to
// check the real build without touching the deployable artifacts.
const flags = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

async function run() {
  const outDir = resolve(projectRoot, flags.get("out-dir") || "dist");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [resolve(projectRoot, "src/lambda.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: resolve(outDir, "lambda.js"),
    sourcemap: true,
    minify: false,
    treeShaking: true,
    external: [
      // Provided by Lambda runtime
      "@aws-sdk/*",
    ],
    banner: {
      js: "// Bundled Lambda handler for workshop/backend",
    },
    // Tells gameCode/runtime.ts to start the prebuilt worker instead of
    // bundling it from source (a branch that reads `import.meta.url`, which
    // CommonJS output doesn't have — hence the silenced warning).
    define: { __GAME_CODE_WORKER_FILE__: JSON.stringify(GAME_CODE_WORKER_FILE) },
    logOverride: { "empty-import-meta": "silent" },
    logLevel: "info",
  });

  await build({
    entryPoints: [resolve(projectRoot, "src/lib/gameCode/sandboxWorker.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: resolve(outDir, GAME_CODE_WORKER_FILE),
    sourcemap: false,
    minify: false,
    logLevel: "info",
  });

  // Include the drizzle migrations alongside the handler so a one-shot
  // Lambda invocation can run them from production.
  await copyDir(resolve(projectRoot, "drizzle"), resolve(outDir, "drizzle")).catch(() => {
    // drizzle dir may not exist yet on a fresh repo; that's fine.
  });

  if (flags.has("no-zip")) return;
  const zipPath = resolve(projectRoot, "lambda.zip");
  await rm(zipPath, { force: true });
  await zipDir(outDir, zipPath);
  console.log(`built ${zipPath}`);
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  const { copyFile } = await import("node:fs/promises");
  for (const entry of entries) {
    const s = resolve(src, entry.name);
    const d = resolve(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }
}

function zipDir(dir, out) {
  return new Promise((resolvePromise, rejectPromise) => {
    const zip = spawn("zip", ["-qr", out, "."], { cwd: dir, stdio: "inherit" });
    zip.on("error", rejectPromise);
    zip.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`zip exited ${code}`));
    });
  });
}

run().catch((err) => {
  console.error("bundle failed", err);
  process.exit(1);
});
