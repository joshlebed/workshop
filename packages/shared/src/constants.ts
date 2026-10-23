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

// Which surface a game-score write arrived from at PUT /v1/games/:id/scores
// (`entrySource`). Optional on the wire (older clients omit it → NULL in
// `game_scores.entry_source`). Not to be confused with `score_source`
// (`parsed` | `picked`), which is how the stored value was derived.
export const GAME_SCORE_ENTRY_SOURCES = ["share_extension", "paste"] as const;
export type GameScoreEntrySource = (typeof GAME_SCORE_ENTRY_SOURCES)[number];

// Canonical `user_flags` keys — shared so backend writers and client readers
// can't drift. `shareExtensionScore` is written server-side on the first score
// that arrives with entrySource "share_extension" (value `{ firstAt }`): the only
// reliable "this user actually set up the share sheet" signal, since iOS has
// no API to detect share-panel membership.
export const USER_FLAG_KEYS = {
  shareExtensionScore: "games.share-extension-score",
} as const;

// Workshop → HighScore games cutover. Workshop's frozen Games UI keeps working
// until this instant (midnight Pacific, 2026-10-31), then every Workshop games
// surface becomes a hand-off to HighScore and the backend answers Workshop
// clients' games calls with 410. One constant drives the client gate, the
// backend gate, and the pre-sunset banner copy so the three can't disagree.
export const WORKSHOP_GAMES_SUNSET_AT = "2026-10-31T07:00:00Z";
export const HIGHSCORE_WEB_URL = "https://highscore.live";
export const HIGHSCORE_APP_STORE_URL =
  "https://apps.apple.com/us/app/highscore-daily-games/id6805206753";
export const HIGHSCORE_APP_SCHEME = "highscore";
