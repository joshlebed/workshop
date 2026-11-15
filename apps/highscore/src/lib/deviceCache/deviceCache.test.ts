import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// `react-native-mmkv` is a native module: loaded at module scope, a binary
// where it cannot open would crash on launch instead of going without a cache.
describe("source guard", () => {
  const appRoot = join(__dirname, "..", "..", "..");
  const self = join(__dirname, "impl.ts");

  it("loads react-native-mmkv only through one lazy require inside a try", () => {
    const src = readFileSync(self, "utf8");
    expect(src).not.toMatch(/^import(?!\s+type)[^;]*from\s+"react-native-mmkv"/m);
    expect(src).not.toMatch(/(?<!typeof )import\("react-native-mmkv"\)/);
    expect(src.match(/require\("react-native-mmkv"\)/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/try\s*\{\s*const \{ createMMKV \} = require\("react-native-mmkv"\)/);
  });

  it("no other HighScore module references react-native-mmkv", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && p !== self) {
          if (readFileSync(p, "utf8").includes("react-native-mmkv")) {
            offenders.push(relative(appRoot, p));
          }
        }
      }
    };
    walk(join(appRoot, "src"));
    walk(join(appRoot, "app"));
    expect(offenders).toEqual([]);
  });
});
