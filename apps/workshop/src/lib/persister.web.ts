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

export function createPersister(key: string): Persister {
  const storage =
    typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : memoryStorageFallback();
  return createSyncStoragePersister({
    storage,
    key,
  });
}
