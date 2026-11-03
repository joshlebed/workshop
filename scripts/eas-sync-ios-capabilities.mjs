#!/usr/bin/env node
// Syncs the main app target's declared iOS entitlements (app.json +
// config plugins, resolved via `expo config --type introspect`) to its App ID
// in the Apple Developer Portal, using the ASC API key from the EXPO_ASC_*
// env vars. Run in CI right before `eas build`.
//
// Why: in `--non-interactive` mode eas-cli's best-effort Apple auth returns
// early (credentials/context.js), so the FIRST target's
// `ensureBundleIdExistsAsync` — the step that enables capabilities on the
// App ID — is skipped. Only later targets (the share extension) get synced,
// because auth happens lazily when a profile has to be created. A new
// entitlement (Push, 2026-11-03) then lands in a profile that doesn't have
// it: "Provisioning profile doesn't include the Push Notifications
// capability". This script does the sync eas-cli would have done.
//
//   node scripts/eas-sync-ios-capabilities.mjs apps/highscore
//
// Needs: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID,
// EXPO_APPLE_TEAM_ID, EXPO_APPLE_TEAM_TYPE. Uses eas-cli internals (pinned
// in each app's devDependencies); re-check the import paths on an eas-cli bump
// (last verified against eas-cli 27.4.0, where non-interactive builds still
// skip the best-effort Apple auth, so this step is still needed).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const appDir = resolve(process.argv[2] ?? ".");
const require = createRequire(resolve(appDir, "package.json"));

for (const name of [
  "EXPO_ASC_API_KEY_PATH",
  "EXPO_ASC_KEY_ID",
  "EXPO_ASC_ISSUER_ID",
  "EXPO_APPLE_TEAM_ID",
  "EXPO_APPLE_TEAM_TYPE",
]) {
  if (!process.env[name]) {
    console.error(`eas-sync-ios-capabilities: ${name} is not set`);
    process.exit(1);
  }
}

const configJson = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
  cwd: appDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const config = JSON.parse(configJson);
const bundleIdentifier = config.ios?.bundleIdentifier;
const entitlements = config.ios?.entitlements ?? {};
if (!bundleIdentifier) {
  console.error("eas-sync-ios-capabilities: ios.bundleIdentifier missing from resolved config");
  process.exit(1);
}
console.log(
  `Entitlements for ${bundleIdentifier}: ${Object.keys(entitlements).join(", ") || "(none)"}`,
);

const { authenticateAsync } = require("eas-cli/build/credentials/ios/appstore/authenticate.js");
const {
  AuthenticationMode,
} = require("eas-cli/build/credentials/ios/appstore/authenticateTypes.js");
const {
  ensureBundleIdExistsWithNameAsync,
} = require("eas-cli/build/credentials/ios/appstore/ensureAppExists.js");

const authCtx = await authenticateAsync({ mode: AuthenticationMode.API_KEY });
await ensureBundleIdExistsWithNameAsync(
  authCtx,
  { name: config.name ?? bundleIdentifier, bundleIdentifier },
  { entitlements },
);
console.log(`Capabilities synced for ${bundleIdentifier}`);
