// The ONLY module in HighScore that may load `@bacons/apple-targets`.
//
// The widget extension and its `ExtensionStorage` native module exist only in
// the 1.4.0+ binary, but every OTA also ships to older runtimes
// (supported-runtimes.json). So, like `pushNotifications.ts`, this facade:
//   1. reports unsupported on web/Android and on any runtime below 1.4.0,
//   2. only then `require`s the package — lazily, inside a function, never at
//      module scope,
//   3. treats a throwing require (or a missing native module) as unsupported.
//
// Data path: `writeSnapshot` stores one JSON string under `widget.snapshot` in
// the App Group's UserDefaults and reloads the widget's timeline; the widget
// (targets/widget/HighScoreWidget.swift) reads it and writes back
// `widget.timelineAt` / `widget.families` when it builds a timeline, which is
// how the app learns a widget is on the home screen.

import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { runtimeHasWidget, type WidgetMarker, type WidgetSnapshot } from "./widgetSnapshot";

type AppleTargetsModule = typeof import("@bacons/apple-targets");
type Storage = InstanceType<AppleTargetsModule["ExtensionStorage"]>;

export const WIDGET_APP_GROUP = "group.live.highscore.app";
/** WidgetKit `kind` of the widget (`widgetKind` in HighScoreWidget.swift). */
export const WIDGET_KIND = "HighScoreWidget";
const SNAPSHOT_KEY = "widget.snapshot";
const TIMELINE_MARKER_KEY = "widget.timelineAt";
const FAMILIES_KEY = "widget.families";

export interface HomeWidgetEnv {
  os: string;
  runtimeVersion: string | null;
  /** Loads `@bacons/apple-targets`; called at most once, only past the gate. */
  load: () => AppleTargetsModule;
}

export interface HomeWidget {
  isSupported(): boolean;
  /** Store the snapshot and ask WidgetKit to rebuild the timeline. False = not written. */
  writeSnapshot(snapshot: WidgetSnapshot): boolean;
  /** What the widget left in the App Group; null when unsupported or never run. */
  readMarker(): WidgetMarker | null;
}

export function createHomeWidget(env: HomeWidgetEnv): HomeWidget {
  let loaded: { mod: AppleTargetsModule; storage: Storage } | null | undefined;

  function get() {
    if (loaded !== undefined) return loaded;
    if (!runtimeHasWidget(env.os, env.runtimeVersion)) {
      loaded = null;
      return loaded;
    }
    try {
      const mod = env.load();
      loaded = { mod, storage: new mod.ExtensionStorage(WIDGET_APP_GROUP) };
    } catch {
      loaded = null;
    }
    return loaded;
  }

  return {
    isSupported: () => get() !== null,

    writeSnapshot(snapshot) {
      const m = get();
      if (!m) return false;
      try {
        m.storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
        m.mod.ExtensionStorage.reloadWidget(WIDGET_KIND);
        return true;
      } catch {
        return false;
      }
    },

    readMarker() {
      const m = get();
      if (!m) return null;
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

// --- The app's instance -----------------------------------------------------

/** The lazy loader. The only `@bacons/apple-targets` value reference in the app. */
function loadAppleTargets(): AppleTargetsModule {
  return require("@bacons/apple-targets") as AppleTargetsModule;
}

const widget = createHomeWidget({
  os: Platform.OS,
  // `appVersion` runtime policy: runtime version === the binary's app.json version.
  runtimeVersion: Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
  load: loadAppleTargets,
});

export const isHomeWidgetSupported = (): boolean => widget.isSupported();
export const writeWidgetSnapshot = (snapshot: WidgetSnapshot): boolean =>
  widget.writeSnapshot(snapshot);
export const readWidgetMarker = (): WidgetMarker | null => widget.readMarker();
