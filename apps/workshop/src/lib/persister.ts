import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

export function createPersister(key: string): Persister {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key,
  });
}
