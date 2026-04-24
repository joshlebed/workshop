import * as SecureStore from "expo-secure-store";

// Native (iOS) implementation. Web uses `storage.web.ts`.
// Metro resolves `.web.ts(x)` before `.ts(x)` on web so this file is
// iOS/Android-only at runtime.

export async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
