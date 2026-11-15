// Native: MMKV, which the 1.2.0+ binaries preload (apps/highscore/CLAUDE.md →
// "Preloaded natives"). This is the only module that may load
// `react-native-mmkv`, and it does so lazily and inside a try/catch: a binary
// without the native module, or one where it fails to open, degrades to "no
// cache" (every read misses, every write is dropped) instead of crashing the
// OTA that carries this file.

import type { MMKV } from "react-native-mmkv";

type MmkvModule = typeof import("react-native-mmkv");

let store: MMKV | null | undefined;

function open(): MMKV | null {
  if (store !== undefined) return store;
  try {
    const { createMMKV } = require("react-native-mmkv") as MmkvModule;
    store = createMMKV({ id: "highscore.device-cache" });
  } catch {
    store = null;
  }
  return store;
}

export function deviceCacheGet(key: string): string | null {
  try {
    return open()?.getString(key) ?? null;
  } catch {
    return null;
  }
}

export function deviceCacheSet(key: string, value: string): void {
  try {
    open()?.set(key, value);
  } catch {
    // A full disk or a closed store: the cache is an optimisation.
  }
}

export function deviceCacheRemove(key: string): void {
  try {
    open()?.remove(key);
  } catch {
    // Nothing to remove from a store that never opened.
  }
}
