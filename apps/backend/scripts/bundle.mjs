#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

async function run() {
  const outDir = resolve(projectRoot, "dist");
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
    logLevel: "info",
  });

  // Include the drizzle migrations alongside the handler so a one-shot
  // Lambda invocation can run them from production.
  await copyDir(resolve(projectRoot, "drizzle"), resolve(outDir, "drizzle")).catch(() => {
    // drizzle dir may not exist yet on a fresh repo; that's fine.
  });

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
