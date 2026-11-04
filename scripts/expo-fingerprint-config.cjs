// Shared `@expo/fingerprint` config for both Expo apps. Each app's
// `fingerprint.config.cjs` re-exports it; `@expo/fingerprint` loads that file
// from the app directory in CI (`testflight*.yml`, `runtime-version-guard.yml`)
// and on the EAS build worker.
//
// Why: the TestFlight workflows build a new iOS binary whenever the fingerprint
// changes, and each binary costs an EAS build (the Free plan has a monthly
// cap). On 2026-11-03 two JS-only PRs moved both apps' fingerprints —
// `package.json` `scripts` (the typecheck script switched to tsgo) and
// `eas.json` `cli.version` (the eas-cli bump) — and burned four builds for
// no native change. Neither input affects the binary:
//
// - `scripts` are never run by prebuild (SourceSkips.PackageJsonScriptsAll).
// - `eas.json` `cli` is the local CLI version floor + appVersionSource. The
//   rest of eas.json (build profiles, submit config) still counts.
const { SourceSkips } = require("@expo/fingerprint");

const EAS_JSON_STRIPPED_KEYS = ["cli"];
const easJsonChunks = [];

/** @type {import("@expo/fingerprint").Config} */
module.exports = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
  fileHookTransform(source, chunk, isEndOfFile, encoding) {
    if (source.type !== "file" || source.filePath !== "eas.json") {
      return chunk;
    }
    if (chunk != null) {
      easJsonChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }
    if (!isEndOfFile) {
      return null;
    }
    const raw = Buffer.concat(easJsonChunks.splice(0)).toString("utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw; // unparseable: hash it verbatim rather than hide a change
    }
    if (parsed && typeof parsed === "object") {
      for (const key of EAS_JSON_STRIPPED_KEYS) {
        delete parsed[key];
      }
    }
    return JSON.stringify(parsed);
  },
};
