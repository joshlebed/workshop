#!/usr/bin/env node
// Verify an app's React Native stack matches the Expo SDK that is
// actually installed — i.e. the `expo/bundledNativeModules.json` shipped
// inside the `expo` version the lockfile resolves. Deterministic by
// construction: same commit + same lockfile => same verdict, forever.
//
// This replaces `expo install --check`, which merges Expo's *remote*
// well-known-versions endpoint over the bundled map and prefers the remote
// value. That endpoint moves on Expo's release cadence, not ours, so an
// untouched commit flips red weeks after it merged (SDK 55 shipped RN 0.83.6;
// the endpoint now recommends 0.83.10 and expo ~55.0.29). `EXPO_OFFLINE=1`
// is not a fix — it makes `validateDependenciesVersionsAsync` return early
// and validate nothing at all, which silently deletes the guard.
//
// Two invariants per package:
//   1. installed version satisfies the SDK's bundled range (same semantics as
//      Expo's own `isDependencyVersionIncorrect`)
//   2. the range declared in package.json is a subset of the SDK's bundled
//      range, so a future `pnpm update` can't resolve outside the SDK

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import subset from "semver/ranges/subset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const appDir = resolve(repoRoot, process.argv[2] ?? "apps/workshop");
const appPath = relative(repoRoot, appDir);

// Scoped on purpose — the SDK's bundled map also pins react/react-dom and
// eslint-config-expo, which the monorepo intentionally pins above the
// SDK-preferred versions. RN + its satellites are the ones that must track
// the SDK, because they ship native code the Expo prebuild links against.
const PACKAGES = [
  "react-native",
  "react-native-gesture-handler",
  "react-native-reanimated",
  "react-native-safe-area-context",
  "react-native-screens",
  "react-native-worklets",
];

const requireFromApp = createRequire(join(appDir, "package.json"));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const appPkg = readJson(join(appDir, "package.json"));
const declaredDeps = { ...appPkg.dependencies, ...appPkg.devDependencies };

const expoPkg = readJson(requireFromApp.resolve("expo/package.json"));
const bundled = readJson(requireFromApp.resolve("expo/bundledNativeModules.json"));

const errors = [];

for (const name of PACKAGES) {
  const expected = bundled[name];
  if (!expected) {
    errors.push(
      `${name}: not listed in expo@${expoPkg.version} bundledNativeModules.json ` +
        `(renamed or dropped from the SDK? update PACKAGES in this script)`,
    );
    continue;
  }

  const declared = declaredDeps[name];
  if (!declared) {
    errors.push(`${name}: not declared in ${appPath}/package.json`);
    continue;
  }

  let installed;
  try {
    installed = readJson(requireFromApp.resolve(`${name}/package.json`)).version;
  } catch {
    errors.push(`${name}: declared but not installed — run \`pnpm install\``);
    continue;
  }

  if (!semver.satisfies(installed, expected, { includePrerelease: true })) {
    errors.push(`${name}@${installed} installed, but expo@${expoPkg.version} bundles ${expected}`);
    continue;
  }

  if (!semver.validRange(declared)) {
    errors.push(`${name}: declared version "${declared}" is not a valid semver range`);
    continue;
  }

  if (!subset(declared, expected)) {
    errors.push(
      `${name}: declared range "${declared}" is not a subset of the SDK range ` +
        `"${expected}" — a future install could resolve outside the SDK`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Expo SDK dependency check failed (expo@${expoPkg.version}):`);
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    `\nFix by aligning ${appPath}/package.json with the installed SDK, or by ` +
      "bumping `expo` itself (which moves bundledNativeModules.json with it).",
  );
  process.exit(1);
}

console.log(
  `Expo SDK dependency check OK (expo@${expoPkg.version}, ${PACKAGES.length} packages match bundledNativeModules.json)`,
);
