#!/usr/bin/env node
// Prints the `d` path strings for one or more pixelarticons glyphs, ready to
// paste into `src/theme/pixelIconPaths.ts`. The icons are vendored as path data
// because neither Metro nor the Cloudflare Pages bundle handle raw `.svg`
// imports; this script is the one consumer of the `pixelarticons` package.
//
//   node apps/highscore/scripts/pixel-icon-paths.mjs chevron-down trash
// (deliberately not an npm script: @expo/fingerprint hashes package.json
// scripts, and keeping them unchanged keeps the iOS runtime at 1.0.1.)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const svgDir = join(dirname(require.resolve("pixelarticons/package.json")), "svg");

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: pixel-icon-paths <icon-name> [...more]");
  process.exit(1);
}

for (const name of names) {
  const svg = readFileSync(join(svgDir, `${name}.svg`), "utf8");
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  console.log(`  "${name}": [`);
  for (const d of paths) console.log(`    ${JSON.stringify(d)},`);
  console.log("  ],");
}
