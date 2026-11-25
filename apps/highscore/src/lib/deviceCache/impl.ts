// Native: NSUserDefaults through React Native's own `Settings` module — in
// every binary, synchronous, and fine for a few kilobytes of non-secret text.
//
// Not MMKV, although the 1.2.0+ binaries preload `react-native-mmkv`: in the
// 1.3.0 binary Nitro's JSI bindings never install, so loading it throws — and
// a `try/catch` around a lazy `require` does not help, because Metro reports a
// throwing module factory as a fatal error before the catch sees it
// (apps/highscore/CLAUDE.md → "Preloaded natives"). `deviceCache.test.ts`
// keeps the package out of every source file.

import { Platform, Settings } from "react-native";

const PREFIX = "highscore.device-cache.";
// NSUserDefaults is loaded whole at launch; keep entries small.
const MAX_VALUE_CHARS = 256_000;

// `Settings` is iOS-only (it warns and stores nothing elsewhere).
const available = Platform.OS === "ios";

export function deviceCacheGet(key: string): string | null {
  if (!available) return null;
  try {
    const value = Settings.get(PREFIX + key);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function deviceCacheSet(key: string, value: string): void {
  if (!available || value.length > MAX_VALUE_CHARS) return;
  try {
    Settings.set({ [PREFIX + key]: value });
  } catch {
    // The cache is an optimisation: go without.
  }
}

export function deviceCacheRemove(key: string): void {
  if (!available) return;
  try {
    // A null value removes the key (RCTSettingsManager).
    Settings.set({ [PREFIX + key]: null });
  } catch {
    // Nothing to remove.
  }
}
