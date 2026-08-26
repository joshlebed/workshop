// Pure-runtime constants exported from `@workshop/shared`. Kept in a
// separate module from `types.ts` so the mobile bundler can import them at
// runtime via the `./constants` subpath without pulling in the type-only
// barrel (whose `./types.js` re-export trips Metro — see CLAUDE.md).

// Version stamp the client uses to bust persisted query cache when shapes
// change. Bump on any breaking edit to a request/response type in
// `./types.ts` — the offline persister keys cached state by this string and
// discards anything older on cold start. Pure addition (new optional field,
// new endpoint type) doesn't require a bump.
export const SHARED_TYPES_VERSION = "5";

// Stable product identities sent by @workshop/api-client. The backend uses
// the same tuple to validate X-Workshop-Client before choosing a branded URL.
export const WORKSHOP_CLIENTS = ["workshop", "highscore"] as const;
export type WorkshopClient = (typeof WORKSHOP_CLIENTS)[number];
