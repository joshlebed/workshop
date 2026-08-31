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

// How a game-score write arrived at PUT /v1/games/:id/scores. Optional on the
// wire (older clients omit it → NULL in `game_scores.source`).
export const GAME_SCORE_SOURCES = ["share_extension", "paste"] as const;
export type GameScoreSource = (typeof GAME_SCORE_SOURCES)[number];

// Canonical `user_flags` keys — shared so backend writers and client readers
// can't drift. `shareExtensionScore` is written server-side on the first score
// that arrives with source "share_extension" (value `{ firstAt }`): the only
// reliable "this user actually set up the share sheet" signal, since iOS has
// no API to detect share-panel membership.
export const USER_FLAG_KEYS = {
  shareExtensionScore: "games.share-extension-score",
  // One-time share-sheet announcement on HighScore's Games home. Client-
  // authored: `{ dismissedAt }` when X'd away, `{ completedAt }` when the
  // walkthrough finished. Server-side so a reinstall/second device never
  // re-blasts a user who already dealt with it.
  shareSheetAnnouncement: "games.share-sheet-announcement",
} as const;
