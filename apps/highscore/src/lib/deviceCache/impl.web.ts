// Web: localStorage. Every call is guarded — private windows and blocked
// storage throw on access, and the cache is an optimisation.

const PREFIX = "highscore.device-cache.";

export function deviceCacheGet(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function deviceCacheSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Quota or blocked storage: go without.
  }
}

export function deviceCacheRemove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to remove.
  }
}
