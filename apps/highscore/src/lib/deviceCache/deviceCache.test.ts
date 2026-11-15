import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// `react-native-mmkv` is in the binary but cannot be loaded: Nitro fails to
// install in 1.3.0, and Metro turns a throwing `require` — lazy or not, inside
// a try/catch or not — into a fatal error, so one import crashes every user on
// launch. Until a binary ships a working build of it, no source file may
// load it.
describe("source guard", () => {
  const appRoot = join(__dirname, "..", "..", "..");

  it("no HighScore module imports or requires react-native-mmkv", () => {
    const offenders: string[] = [];
    const loads = /(?:from\s+|require\(|import\()\s*["']react-native-(?:mmkv|nitro-modules)["']/;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && loads.test(readFileSync(p, "utf8"))) {
          offenders.push(relative(appRoot, p));
        }
      }
    };
    walk(join(appRoot, "src"));
    walk(join(appRoot, "app"));
    expect(offenders).toEqual([]);
  });
});
