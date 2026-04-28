import { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { createPersister } from "./persister";

const PERSIST_STORAGE_KEY = "workshop.query-cache.v1";

export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Mirror of `SHARED_TYPES_VERSION` in `packages/shared/src/types.ts`. Kept
// inline (rather than imported) so Metro doesn't have to resolve the shared
// package at runtime — only `import type` from `@workshop/shared` is safe in
// the bundle. `query.test.ts` asserts these two stay in lock-step, so a
// missed bump fails CI before it ships stale persisted state.
export const PERSIST_TYPES_VERSION = "1";

export function getPersistBusterKey(typesVersion: string = PERSIST_TYPES_VERSION): string {
  return `workshop:${typesVersion}`;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 30_000,
        gcTime: PERSIST_MAX_AGE_MS,
        retry: (failureCount, error) => {
          if (error && typeof error === "object" && "status" in error) {
            const status = (error as { status: number }).status;
            if (status === 401 || status === 403 || status === 404) return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function getPersistOptions(): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister: createPersister(PERSIST_STORAGE_KEY),
    maxAge: PERSIST_MAX_AGE_MS,
    buster: getPersistBusterKey(),
    dehydrateOptions: {
      // Don't persist mutations — they're transient. Failed mutations should
      // surface a "Retry?" toast in-session, not survive a cold start.
      shouldDehydrateMutation: () => false,
      // Don't persist failed queries; rehydrating an error-shaped cache entry
      // would race the live refetch and confuse the UI.
      shouldDehydrateQuery: (query) => query.state.status === "success",
    },
  };
}
