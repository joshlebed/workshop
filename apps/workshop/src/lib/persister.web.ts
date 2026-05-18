import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

const memoryStorageFallback = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) ?? null) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
};

// Reading `window.localStorage` can throw in restricted WebViews — notably
// iOS Messages's in-app preview ("Open in Safari" sheet). An uncaught throw
// here crashes the React tree on first render because this runs inside
// `getPersistOptions()` from `RootLayout`'s `useMemo`. Wrap the access, fall
// back to memory storage, and let the rest of the app come up.
function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createPersister(key: string): Persister {
  const storage = safeLocalStorage() ?? memoryStorageFallback();
  return createSyncStoragePersister({
    storage,
    key,
  });
}
