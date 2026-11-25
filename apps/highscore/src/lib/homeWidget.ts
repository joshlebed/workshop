// The ONLY module in HighScore that may load `@bacons/apple-targets` (and the
// only one that touches the App Group container).
//
// The widget extension and its `ExtensionStorage` native module exist only in
// the 1.4.0+ binary, but every OTA also ships to older runtimes
// (supported-runtimes.json). So, like `pushNotifications.ts`, this facade:
//   1. reports unsupported on web/Android and on any runtime below 1.4.0,
//   2. only then `require`s the package — lazily, inside a function, never at
//      module scope,
//   3. treats a throwing require (or a missing native module) as unsupported.
//
// Data path: `writeSnapshot` writes `widget-snapshot.json` into the App Group
// container (expo-file-system; UserDefaults `widget.snapshot` as a fallback)
// and reloads the widget's timeline; the widget
// (targets/widget/HighScoreWidget.swift) reads it and writes back
// `widget-marker.json` when it builds a timeline, which is how the app learns a
// widget is on the home screen. A file, not UserDefaults, is the primary
// channel because the simulator showed the widget's process reading a stale
// UserDefaults value after the app's write and reload.

import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { runtimeHasWidget, type WidgetMarker, type WidgetSnapshot } from "./widgetSnapshot";

type AppleTargetsModule = typeof import("@bacons/apple-targets");
type FileSystemModule = typeof import("expo-file-system");
type Storage = InstanceType<AppleTargetsModule["ExtensionStorage"]>;
type GroupDirectory = InstanceType<FileSystemModule["Directory"]>;

export const WIDGET_APP_GROUP = "group.live.highscore.app";
/** WidgetKit `kind` of the widget (`widgetKind` in HighScoreWidget.swift). */
export const WIDGET_KIND = "HighScoreWidget";
const SNAPSHOT_KEY = "widget.snapshot";
const TIMELINE_MARKER_KEY = "widget.timelineAt";
const FAMILIES_KEY = "widget.families";
const SNAPSHOT_FILE = "widget-snapshot.json";
const MARKER_FILE = "widget-marker.json";
/** Delay before the second reload that follows every snapshot write. */
export const WIDGET_RELOAD_SETTLE_MS = 1500;

export interface HomeWidgetEnv {
  os: string;
  runtimeVersion: string | null;
  /** Loads `@bacons/apple-targets`; called at most once, only past the gate. */
  load: () => AppleTargetsModule;
  /** Loads `expo-file-system` for the App Group container; same rules. */
  loadFiles: () => FileSystemModule;
}

export interface HomeWidget {
  isSupported(): boolean;
  /** Store the snapshot and ask WidgetKit to rebuild the timeline. False = not written. */
  writeSnapshot(snapshot: WidgetSnapshot): boolean;
  /** What the widget left in the App Group; null when unsupported or never run. */
  readMarker(): WidgetMarker | null;
}

export function createHomeWidget(env: HomeWidgetEnv): HomeWidget {
  let loaded:
    | {
        mod: AppleTargetsModule;
        storage: Storage;
        files: FileSystemModule | null;
        group: GroupDirectory | null;
      }
    | null
    | undefined;

  function get() {
    if (loaded !== undefined) return loaded;
    if (!runtimeHasWidget(env.os, env.runtimeVersion)) {
      loaded = null;
      return loaded;
    }
    try {
      const mod = env.load();
      let files: FileSystemModule | null = null;
      let group: GroupDirectory | null = null;
      try {
        files = env.loadFiles();
        group = files.Paths.appleSharedContainers[WIDGET_APP_GROUP] ?? null;
      } catch {
        files = null;
      }
      loaded = { mod, storage: new mod.ExtensionStorage(WIDGET_APP_GROUP), files, group };
    } catch {
      loaded = null;
    }
    return loaded;
  }

  function groupFile(name: string) {
    const m = get();
    if (!m?.files || !m.group) return null;
    return new m.files.File(m.group, name);
  }

  function writeFile(name: string, text: string): boolean {
    try {
      const file = groupFile(name);
      if (!file) return false;
      if (!file.exists) file.create();
      file.writeSync(text);
      return true;
    } catch {
      return false;
    }
  }

  function readFile(name: string): string | null {
    try {
      const file = groupFile(name);
      return file?.exists ? file.textSync() : null;
    } catch {
      return null;
    }
  }

  return {
    isSupported: () => get() !== null,

    writeSnapshot(snapshot) {
      const m = get();
      if (!m) return false;
      const json = JSON.stringify(snapshot);
      const wroteFile = writeFile(SNAPSHOT_FILE, json);
      try {
        m.storage.set(SNAPSHOT_KEY, json);
        m.mod.ExtensionStorage.reloadWidget(WIDGET_KIND);
      } catch {
        if (!wroteFile) return false;
      }
      // The write reaches the widget's process through cfprefsd asynchronously,
      // so the immediate reload can render the previous snapshot (seen on the
      // simulator: a timeline built at the moment of a post, showing the old
      // state). Ask once more after the write has landed.
      setTimeout(() => {
        try {
          m.mod.ExtensionStorage.reloadWidget(WIDGET_KIND);
        } catch {
          /* best effort */
        }
      }, WIDGET_RELOAD_SETTLE_MS);
      return true;
    },

    readMarker() {
      const m = get();
      if (!m) return null;
      const fromFile = parseMarker(readFile(MARKER_FILE));
      if (fromFile) return fromFile;
      try {
        const timelineAt = m.storage.get(TIMELINE_MARKER_KEY);
        const families = (m.storage.get(FAMILIES_KEY) ?? "").split(",").filter(Boolean);
        return timelineAt ? { timelineAt, families } : null;
      } catch {
        return null;
      }
    },
  };
}

/** `widget-marker.json`: `{ "timelineAt": ISO, "families": "medium,small" }`. */
function parseMarker(text: string | null): WidgetMarker | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object") return null;
    const { timelineAt, families } = raw as Record<string, unknown>;
    if (typeof timelineAt !== "string") return null;
    return {
      timelineAt,
      families: typeof families === "string" ? families.split(",").filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

// --- The app's instance -----------------------------------------------------

/** The lazy loader. The only `@bacons/apple-targets` value reference in the app. */
function loadAppleTargets(): AppleTargetsModule {
  return require("@bacons/apple-targets") as AppleTargetsModule;
}

/** expo-file-system ships in every binary (an `expo` dependency); loaded past the same gate. */
function loadFileSystem(): FileSystemModule {
  return require("expo-file-system") as FileSystemModule;
}

const widget = createHomeWidget({
  os: Platform.OS,
  // `appVersion` runtime policy: runtime version === the binary's app.json version.
  runtimeVersion: Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
  load: loadAppleTargets,
  loadFiles: loadFileSystem,
});

export const isHomeWidgetSupported = (): boolean => widget.isSupported();
export const writeWidgetSnapshot = (snapshot: WidgetSnapshot): boolean =>
  widget.writeSnapshot(snapshot);
export const readWidgetMarker = (): WidgetMarker | null => widget.readMarker();
