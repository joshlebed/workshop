import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Any ESM load of the package fails the test outright.
vi.mock("@bacons/apple-targets", () => {
  throw new Error("@bacons/apple-targets must not be loaded on this runtime");
});
vi.mock("expo-file-system", () => {
  throw new Error("expo-file-system must not be loaded on this runtime");
});
vi.mock("expo-updates", () => ({ runtimeVersion: "1.3.0" }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.3.0" } } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  createHomeWidget,
  type HomeWidgetEnv,
  isHomeWidgetSupported,
  WIDGET_APP_GROUP,
  WIDGET_KIND,
  WIDGET_RELOAD_SETTLE_MS,
  writeWidgetSnapshot,
} from "./homeWidget";
import { signedOutWidgetSnapshot } from "./widgetSnapshot";

type Mod = ReturnType<HomeWidgetEnv["load"]>;
type Files = ReturnType<HomeWidgetEnv["loadFiles"]>;

/** An in-memory App Group container with expo-file-system's File shape. */
function fakeFiles(group: string | null = WIDGET_APP_GROUP) {
  const disk = new Map<string, string>();
  class Directory {
    constructor(public uri: string) {}
  }
  class File {
    path: string;
    constructor(dir: Directory, name: string) {
      this.path = `${dir.uri}/${name}`;
    }
    get exists() {
      return disk.has(this.path);
    }
    create() {
      disk.set(this.path, "");
    }
    writeSync(text: string) {
      disk.set(this.path, text);
    }
    textSync() {
      return disk.get(this.path) ?? "";
    }
  }
  const containers: Record<string, Directory> = group ? { [group]: new Directory("/group") } : {};
  const files = {
    File,
    Directory,
    Paths: { appleSharedContainers: containers },
  } as unknown as Files;
  return { files, disk };
}

function fakeModule() {
  const store = new Map<string, string>();
  const reloads: (string | undefined)[] = [];
  const groups: string[] = [];
  class ExtensionStorage {
    static reloadWidget(name?: string) {
      reloads.push(name);
    }
    constructor(group: string) {
      groups.push(group);
    }
    set(key: string, value?: unknown) {
      store.set(key, String(value));
    }
    get(key: string) {
      return store.get(key) ?? null;
    }
  }
  return { mod: { ExtensionStorage } as unknown as Mod, store, reloads, groups };
}

describe("homeWidget gate", () => {
  it("the app instance stays unsupported on a 1.3.0 binary and never loads the package", () => {
    expect(isHomeWidgetSupported()).toBe(false);
    expect(writeWidgetSnapshot(signedOutWidgetSnapshot("2026-11-25"))).toBe(false);
  });

  it.each([
    ["ios", "1.3.0"],
    ["ios", null],
    ["android", "1.4.0"],
    ["web", "1.4.0"],
  ])("never calls the loader on %s %s", (os, runtimeVersion) => {
    const load = vi.fn();
    const loadFiles = vi.fn();
    const w = createHomeWidget({ os, runtimeVersion, load, loadFiles });
    expect(w.isSupported()).toBe(false);
    expect(w.writeSnapshot(signedOutWidgetSnapshot("2026-11-25"))).toBe(false);
    expect(w.readMarker()).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(loadFiles).not.toHaveBeenCalled();
  });

  it("a throwing require is unsupported", () => {
    const w = createHomeWidget({
      os: "ios",
      runtimeVersion: "1.4.0",
      load: () => {
        throw new Error("Cannot find native module 'ExtensionStorage'");
      },
      loadFiles: () => fakeFiles().files,
    });
    expect(w.isSupported()).toBe(false);
  });

  it("on 1.4.0 writes the snapshot to the App Group and reloads the widget twice", () => {
    vi.useFakeTimers();
    const fake = fakeModule();
    const fs = fakeFiles();
    const w = createHomeWidget({
      os: "ios",
      runtimeVersion: "1.4.0",
      load: () => fake.mod,
      loadFiles: () => fs.files,
    });
    const snap = signedOutWidgetSnapshot("2026-11-25");
    expect(w.writeSnapshot(snap)).toBe(true);
    expect(fake.groups).toEqual([WIDGET_APP_GROUP]);
    // The file the widget reads first, and the UserDefaults fallback.
    expect(JSON.parse(fs.disk.get("/group/widget-snapshot.json") ?? "")).toEqual(snap);
    expect(JSON.parse(fake.store.get("widget.snapshot") ?? "")).toEqual(snap);
    expect(fake.reloads).toEqual([WIDGET_KIND]);
    // A second reload once the write has reached the widget's process.
    vi.advanceTimersByTime(WIDGET_RELOAD_SETTLE_MS);
    expect(fake.reloads).toEqual([WIDGET_KIND, WIDGET_KIND]);
    vi.useRealTimers();
  });

  it("still writes UserDefaults when the App Group container isn't available", () => {
    const fake = fakeModule();
    const w = createHomeWidget({
      os: "ios",
      runtimeVersion: "1.4.0",
      load: () => fake.mod,
      loadFiles: () => fakeFiles(null).files,
    });
    expect(w.writeSnapshot(signedOutWidgetSnapshot("2026-11-25"))).toBe(true);
    expect(fake.store.has("widget.snapshot")).toBe(true);
  });

  it("reads the widget's marker file first", () => {
    const fake = fakeModule();
    const fs = fakeFiles();
    const w = createHomeWidget({
      os: "ios",
      runtimeVersion: "1.4.0",
      load: () => fake.mod,
      loadFiles: () => fs.files,
    });
    fs.disk.set(
      "/group/widget-marker.json",
      JSON.stringify({ timelineAt: "2026-11-25T12:00:00Z", families: "small" }),
    );
    expect(w.readMarker()).toEqual({ timelineAt: "2026-11-25T12:00:00Z", families: ["small"] });
  });

  it("falls back to the UserDefaults timeline marker", () => {
    const fake = fakeModule();
    const w = createHomeWidget({
      os: "ios",
      runtimeVersion: "1.4.0",
      load: () => fake.mod,
      loadFiles: () => fakeFiles().files,
    });
    expect(w.readMarker()).toBeNull();
    fake.store.set("widget.timelineAt", "2026-11-25T11:00:00Z");
    fake.store.set("widget.families", "medium,small");
    expect(w.readMarker()).toEqual({
      timelineAt: "2026-11-25T11:00:00Z",
      families: ["medium", "small"],
    });
  });
});

describe("source guard", () => {
  const appRoot = join(__dirname, "..", "..");
  const self = join(__dirname, "homeWidget.ts");

  it("requires @bacons/apple-targets only inside the lazy loader", () => {
    const src = readFileSync(self, "utf8");
    expect(src).not.toMatch(/^import(?!\s+type)[^;]*from\s+"@bacons\/apple-targets"/m);
    expect(src).not.toMatch(/(?<!typeof )import\("@bacons\/apple-targets"\)/);
    expect(src.match(/require\("@bacons\/apple-targets"\)/g) ?? []).toHaveLength(1);
    expect(src).toMatch(
      /function loadAppleTargets\(\)[^{]*\{\s*return require\("@bacons\/apple-targets"\)/,
    );
  });

  it("no other HighScore module references @bacons/apple-targets", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && p !== self) {
          if (readFileSync(p, "utf8").includes("@bacons/apple-targets")) {
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
