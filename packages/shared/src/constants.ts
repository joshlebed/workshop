// Pure-runtime constants exported from `@workshop/shared`. Kept in a
// separate module from `types.ts` so the mobile bundler can import them at
// runtime via the `./constants` subpath without pulling in the type-only
// barrel (whose `./types.js` re-export trips Metro — see CLAUDE.md).

// Version stamp the client uses to bust persisted query cache when shapes
// change. Bump on any breaking edit to a request/response type in
// `./types.ts` — the offline persister keys cached state by this string and
// discards anything older on cold start. Pure addition (new optional field,
// new endpoint type) doesn't require a bump.
export const SHARED_TYPES_VERSION = "6";

// Stable product identities sent by @workshop/api-client. The backend uses
// the same tuple to validate X-Workshop-Client before choosing a branded URL.
export const WORKSHOP_CLIENTS = ["workshop", "highscore"] as const;
export type WorkshopClient = (typeof WORKSHOP_CLIENTS)[number];

// Chart windows the admin analytics dashboard (`GET /v1/admin/analytics`)
// accepts, in days. Runtime constant so both apps render the same range picker.
// Windows above WEEKLY_BUCKET_ABOVE days are served as weekly buckets.
export const ADMIN_ANALYTICS_RANGES = [7, 30, 90, 365] as const;
export const ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE = 90;
export const ADMIN_ANALYTICS_BUCKETS = ["day", "week"] as const;
export type AdminAnalyticsBucket = (typeof ADMIN_ANALYTICS_BUCKETS)[number];
// Fixed-order platform segments for stacked charts (never re-ordered by rank).
export const ADMIN_ANALYTICS_PLATFORMS = ["ios", "web", "other"] as const;
export type AdminAnalyticsPlatform = (typeof ADMIN_ANALYTICS_PLATFORMS)[number];
export type AdminAnalyticsRange = (typeof ADMIN_ANALYTICS_RANGES)[number];

// Which surface a game-score write arrived from at PUT /v1/games/:id/scores
// (`entrySource`). Optional on the wire (older clients omit it → NULL in
// `game_scores.entry_source`). Not to be confused with `score_source`
// (`parsed` | `picked`), which is how the stored value was derived.
export const GAME_SCORE_ENTRY_SOURCES = ["share_extension", "paste"] as const;
export type GameScoreEntrySource = (typeof GAME_SCORE_ENTRY_SOURCES)[number];

// `users.signup_source` — how a new account found the app, recorded once at
// signup (apps/backend/src/lib/signupAttribution.ts). `none` = the client sent
// attribution and it was empty (App Store / direct / typed URL). NULL in the
// column (not a member here) = pre-attribution account or client.
export const SIGNUP_SOURCES = [
  "friend_invite",
  "play_link",
  "list_invite",
  "web_referral",
  "none",
] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

// Canonical `user_flags` keys — shared so backend writers and client readers
// can't drift. `shareExtensionScore` is written server-side on the first score
// that arrives with entrySource "share_extension" (value `{ firstAt }`): the only
// reliable "this user actually set up the share sheet" signal, since iOS has
// no API to detect share-panel membership.
//
// `appUpdateDismissed` is client-authored (`{ version }`): the HighScore
// "new version on the App Store" banner was dismissed for that latestVersion.
// A newer latestVersion no longer matches, so the banner comes back.
export const USER_FLAG_KEYS = {
  shareExtensionScore: "games.share-extension-score",
  appUpdateDismissed: "app.update-banner-dismissed",
  /** HighScore's one-time "daily nudge?" pre-prompt was answered (`{ choice, at }`). */
  playReminderPrompted: "games.play-reminder-prompted",
  // One-time share-sheet announcement on HighScore's Games home. Client-
  // authored: `{ dismissedAt }` when X'd away, `{ completedAt }` when the
  // walkthrough finished. Server-side so a reinstall/second device never
  // re-blasts a user who already dealt with it.
  shareSheetAnnouncement: "games.share-sheet-announcement",
} as const;

// Operator-set "update from the App Store" nudge (`client_releases`, read by
// `GET /v1/client/release`, written ONLY by the operator through
// `PUT /v1/admin/client-release` from the admin dashboard — see
// docs/release-nudge-runbook.md). Versions are plain `major.minor.patch`.
export const CLIENT_RELEASE_PLATFORMS = ["ios", "android", "web"] as const;
export type ClientReleasePlatform = (typeof CLIENT_RELEASE_PLATFORMS)[number];
export const CLIENT_RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// Workshop → HighScore games cutover. From WORKSHOP_GAMES_SUNSET_AT (midnight
// Pacific) the backend answers Workshop clients' games calls with 410
// (`middleware/workshop-games-sunset.ts`) — the backstop for installs that
// never took the OTA. The Workshop client itself dropped every games surface
// on 2026-11-06; only the `/g/:token` → HighScore link hand-off remains, which
// uses the HighScore URLs below.
export const WORKSHOP_GAMES_SUNSET_AT = "2026-10-31T07:00:00Z";
export const HIGHSCORE_WEB_URL = "https://highscore.live";
export const HIGHSCORE_APP_STORE_URL =
  "https://apps.apple.com/us/app/highscore-daily-games/id6805206753";
export const HIGHSCORE_APP_SCHEME = "highscore";

/**
 * Operator push panel limits (`POST /v1/admin/push/send`, HighScore admin →
 * Push). Operator only, by hand — docs/push-runbook.md.
 */
export const ADMIN_PUSH_MAX_RECIPIENTS = 500;
export const ADMIN_PUSH_TITLE_MAX = 100;
export const ADMIN_PUSH_BODY_MAX = 500;
