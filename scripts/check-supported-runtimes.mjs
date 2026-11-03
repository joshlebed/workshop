#!/usr/bin/env node
// Validates apps/highscore/supported-runtimes.json — the list of iOS runtime
// versions (app.json `version` values of binaries users still run) that
// deploy-mobile-highscore.yml publishes every OTA to. Fails when the list is
// empty, malformed, has duplicates, or is missing the current app.json
// version (the binary the next TestFlight build will claim).
//
//   node scripts/check-supported-runtimes.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const listPath = resolve(root, "apps/highscore/supported-runtimes.json");
const appJsonPath = resolve(root, "apps/highscore/app.json");

const list = JSON.parse(readFileSync(listPath, "utf8"));
const version = JSON.parse(readFileSync(appJsonPath, "utf8")).expo.version;
const semver = /^\d+\.\d+\.\d+$/;
const errors = [];

if (!Array.isArray(list) || list.length === 0) errors.push("must be a non-empty JSON array");
else {
  for (const v of list) {
    if (typeof v !== "string" || !semver.test(v))
      errors.push(`invalid runtime version ${JSON.stringify(v)}`);
  }
  if (new Set(list).size !== list.length) errors.push("contains duplicates");
  if (!list.includes(version)) {
    errors.push(
      `missing app.json version ${version} — add it (and keep older entries until a PR imports a native module they lack)`,
    );
  }
}

if (errors.length) {
  for (const e of errors) console.error(`supported-runtimes.json: ${e}`);
  process.exit(1);
}
console.log(`supported-runtimes.json OK: ${list.join(", ")} (app.json version ${version})`);
