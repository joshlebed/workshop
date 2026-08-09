import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);

export const authProviderEnum = pgEnum("auth_provider", ["apple", "google"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    displayName: text("display_name"),
    /**
     * Profile picture, stored as a base64 `data:` URL (same approach as list
     * cover photos — no object store yet). NULL = no custom avatar; clients
     * fall back to initials. Capped by `avatarUrlSchema` in routes/v1/users.ts.
     */
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    /**
     * Server-side session revocation cutoff. When set, any session token whose
     * `iat` is earlier than this timestamp is rejected by the auth middleware,
     * effectively signing the user out of every device. Bumped by the
     * `DELETE /v1/users/me/sessions` endpoint. NULL = never revoked.
     */
    sessionsInvalidatedAt: timestamp("sessions_invalidated_at", { withTimezone: true }),
    /**
     * Account-level Letterboxd username (lowercase, as it appears in
     * `letterboxd.com/<username>/`). Set via `PUT /v1/users/me/letterboxd`,
     * reused by every Letterboxd-match list the user belongs to.
     * NULL = not connected.
     */
    letterboxdUsername: text("letterboxd_username"),
    /** When the user's cached watchlist (`letterboxd_watchlist_films`) was last refreshed. */
    letterboxdSyncedAt: timestamp("letterboxd_synced_at", { withTimezone: true }),
  },
  (t) => ({
    emailLowerIdx: uniqueIndex("users_email_lower_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`email IS NOT NULL`),
  }),
);

export const userIdentities = pgTable(
  "user_identities",
  {
    provider: authProviderEnum("provider").notNull(),
    providerSub: text("provider_sub").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerSub] }),
    userIdx: index("user_identities_user_idx").on(t.userId),
  }),
);

/**
 * Long-lived, independently revocable device sessions. Access tokens remain
 * short-lived HMACs; this row owns refresh rotation, idle/absolute expiry, and
 * the current impersonation target for one browser or native installation.
 * Raw refresh tokens are never stored: the token is derived from `(id,
 * refresh_version)` with `SESSION_SECRET`.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshVersion: integer("refresh_version").notNull().default(1),
    impersonatedUserId: uuid("impersonated_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    platform: text("platform"),
    appVersion: text("app_version"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().default(sql`now()`),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("auth_sessions_user_idx").on(t.userId),
    activeExpiryIdx: index("auth_sessions_active_expiry_idx")
      .on(t.absoluteExpiresAt)
      .where(sql`revoked_at IS NULL`),
  }),
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    color: text("color").notNull(),
    description: text("description"),
    coverPhotoUrl: text("cover_photo_url"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /**
     * Behaviors enabled on this list. Plain text array; the app interprets
     * the names (see `@workshop/shared/modules`). NULL on legacy rows during
     * the migration window; backfilled from `lists.type` in 0014.
     */
    modules: text("modules").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Constrains the kind of items the list accepts. NULL = unconstrained
     * (Blank List). Backfilled from `lists.type` in 0014.
     */
    itemKind: text("item_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Short, public, rotatable identifier used in share URLs (`/l/:slug`).
     * 8 chars of base62; unique across all lists. Backfilled from a
     * Postgres random generator in migration 0019 for legacy rows;
     * generated by `generateShareSlug` for new rows.
     */
    shareSlug: text("share_slug").notNull().unique(),
    /**
     * Link visibility — `off` (slug 404s for non-members), `view` (anyone
     * with the link can read the list), `join` (anyone with the link can
     * join as a member). Defaults to `join` so existing share semantics
     * carry over.
     */
    shareVisibility: text("share_visibility").notNull().default("join"),
  },
  (t) => ({
    ownerIdx: index("lists_owner_idx").on(t.ownerId),
    ownerUpdatedIdx: index("lists_owner_updated_idx").on(t.ownerId, t.updatedAt),
    shareSlugIdx: index("lists_share_slug_idx").on(t.shareSlug),
  }),
);

export const listMembers = pgTable(
  "list_members",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().default(sql`now()`),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    mutedAt: timestamp("muted_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.listId, t.userId] }),
    userIdx: index("list_members_user_idx").on(t.userId),
    ownerUniq: uniqueIndex("list_members_one_owner_idx").on(t.listId).where(sql`role = 'owner'`),
  }),
);

export const listInvites = pgTable(
  "list_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    email: text("email"),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    listIdx: index("list_invites_list_idx").on(t.listId),
    emailIdx: index("list_invites_email_idx").on(t.email),
  }),
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    note: text("note"),
    /**
     * Content shape for this item. Validated per-kind by zod schemas in
     * `@workshop/shared/itemKinds`. NULL on legacy rows during the migration
     * window; backfilled from `items.metadata` in 0014.
     */
    kind: text("kind"),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    /**
     * Manual ordering when the parent list has the `ranking` module enabled.
     * `NULL` = unordered (renders in the recency-sorted section). Backfilled
     * from `items.metadata->>'position'` in 0014.
     */
    position: integer("position"),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Leaderboard score parsing — for items in lists with the `leaderboard`
     * module. `scoreRegex` is a JS regex pattern with a single capture group
     * around the numeric score; the backend applies it (case-insensitive) to
     * the raw score to compute `score_value`. `scoreDirection` controls
     * leaderboard sort: 'desc' = higher is better (default), 'asc' = lower is
     * better (Wordle / Satle / etc.). `gameId` links migrated daily-game list
     * items to the canonical Games surface row; daily-game scores live solely in
     * `game_scores` now (the legacy per-item `item_scores` table was dropped).
     */
    scoreRegex: text("score_regex"),
    scoreDirection: text("score_direction"),
    gameId: uuid("game_id").references(() => games.id, { onDelete: "set null" }),
    /**
     * Suggestion lifecycle on Letterboxd-match lists (`letterboxd` module).
     * `'pending'` = suggested but not yet accepted by another member — the
     * item renders in the suggestions section, outside the ranked list.
     * NULL = a regular item (either never suggested, or promoted on accept).
     */
    suggestionState: text("suggestion_state"),
  },
  (t) => ({
    listIdx: index("items_list_idx").on(t.listId),
    gameIdx: index("items_game_idx").on(t.gameId),
    listCompletedCreatedIdx: index("items_list_completed_created_idx").on(
      t.listId,
      t.completed,
      t.createdAt,
    ),
    listPositionIdx: index("items_list_position_idx").on(t.listId, t.position),
    // Per-kind dedup partial unique indexes. Each item kind that wants
    // sync-time uniqueness declares its dedup field in
    // `@workshop/shared/itemKinds`'s `ITEM_KIND_DEDUP_FIELD`; the matching
    // index lives here. Adding a new dedupping kind is one entry there +
    // one index addition + a follow-up Drizzle migration.
    listKindDedupSpotifyIdx: uniqueIndex("items_list_spotify_album_content_idx")
      .on(t.listId, sql`(${t.content}->>'spotifyAlbumId')`)
      .where(sql`kind = 'spotify_album' AND content ? 'spotifyAlbumId'`),
    listKindDedupMovieIdx: uniqueIndex("items_list_movie_tmdb_id_idx")
      .on(t.listId, sql`(${t.content}->>'tmdbId')`)
      .where(sql`kind = 'movie' AND content ? 'tmdbId'`),
  }),
);

/**
 * Manual, kind-agnostic labels on items (spec §2.1) — many-to-many,
 * normalized lowercase, ≤40 chars. Replaced as a set via
 * `PUT /v1/items/:id/tags`; rows cascade away with the item. The tag index
 * powers the per-list `GET /v1/lists/:id/tags` aggregation.
 */
export const itemTags = pgTable(
  "item_tags",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemId, t.tag] }),
    tagIdx: index("item_tags_tag_idx").on(t.tag),
  }),
);

/**
 * Named, stored tag filters on a list (spec §2.3) — a saved view is a
 * one-tap preset ("Burgers" inside "Date Ideas"). `config` is
 * `{ tags: string[], sort?: string }`. Views are **shared by every list
 * member** (not per-viewer): any member creates one, the creator or the list
 * owner edits/removes it. `created_by` goes NULL (not cascade-delete) if the
 * author leaves so the shared view survives. Rows cascade with the list.
 */
export const listSavedViews = pgTable(
  "list_saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    position: integer("position"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    listIdx: index("list_saved_views_list_idx").on(t.listId),
  }),
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /**
     * Plain text after the 0014 migration — adding a new event type is code
     * only. The `@workshop/shared` `ActivityEventType` union is the source of
     * truth for what's valid.
     */
    eventType: text("event_type").notNull(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    listCreatedIdx: index("activity_events_list_created_idx").on(t.listId, t.createdAt),
    actorCreatedIdx: index("activity_events_actor_created_idx").on(t.actorId, t.createdAt),
  }),
);

export const userActivityReads = pgTable(
  "user_activity_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.listId] }),
  }),
);

export const metadataCache = pgTable(
  "metadata_cache",
  {
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.sourceId] }),
  }),
);

/**
 * External feeds attached to a list. Generalizes the legacy
 * `lists.metadata.spotifyPlaylistUrl` field — sources are first-class rows
 * keyed by (list_id, kind, config). Adding a new source kind is one entry
 * in `@workshop/shared/sourceKinds` plus a server-side sync implementation.
 */
export const listSources = pgTable(
  "list_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull(),
    /**
     * Per-source secrets (OAuth refresh tokens, per-user API keys) — sealed
     * at the application layer before insert. NULL for sources using
     * app-level credentials (today's spotify_playlist + the
     * letterboxd_list public RSS feed). See `lib/sources/secrets.ts` for
     * the seal/open envelope. §3.5 of the redesign.
     */
    secrets: jsonb("secrets"),
    /** Inbound webhook path slug — set for push-driven sources, NULL for pull. */
    webhookSlug: text("webhook_slug"),
    /** Cron interval expressed in seconds. NULL = manual sync only. */
    syncSchedule: text("sync_schedule"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncedBy: uuid("last_synced_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    listIdx: index("list_sources_list_idx").on(t.listId),
    webhookSlugIdx: uniqueIndex("list_sources_webhook_slug_idx")
      .on(t.webhookSlug)
      .where(sql`webhook_slug IS NOT NULL`),
  }),
);

/**
 * Games surface (spec §3) — the global game catalog, deduped by
 * `normalized_url` (see `normalizeGameUrl` in `@workshop/shared/games`).
 * Seeded from the shared game registry (migrations 0023/0031/0032); unknown URLs
 * get a hostname title at find-or-create time. Migrated Lists leaderboard
 * items point at this table through `items.game_id` so both surfaces share the
 * same canonical game and score rows.
 */
export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  normalizedUrl: text("normalized_url").notNull().unique(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  iconUrl: text("icon_url"),
  /** Key into the shared game registry; NULL for unknown games. */
  gameKey: text("game_key"),
  /** 'desc' = bigger is better, 'asc' = lower is better. */
  scoreDirection: text("score_direction").notNull().default("desc"),
  /**
   * User-taught parser spec (ScoreSpec jsonb) for non-registry games — see
   * `@workshop/shared/scoreParsing`. NULL when unset; registry games keep
   * their specs in code and ignore this column.
   */
  scoreSpec: jsonb("score_spec"),
  /**
   * User-taught recap formatter (SummarySpec jsonb) — the display-side twin
   * of `score_spec`; see `@workshop/shared/summarySpec`. Written alongside it
   * by the teach flow. NULL when unset; registry games keep their formatters
   * in code and ignore this column.
   */
  summarySpec: jsonb("summary_spec"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Append-only audit log of the teach flow: one row per successful
 * `PUT /v1/games/:id/score-spec`, written in the same transaction as the
 * `games` update. The catalog row holds only the *current* config; this
 * table answers "who taught what, when" and makes a bad teach a
 * one-UPDATE-revert (copy the previous revision's values back onto `games`,
 * then `scripts/rescore-game.ts`). `taught_by` is SET NULL on user delete so
 * the history outlives the teacher.
 */
export const gameSpecRevisions = pgTable(
  "game_spec_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    taughtBy: uuid("taught_by").references(() => users.id, { onDelete: "set null" }),
    /** The ScoreSpec stored on the catalog row by this teach. */
    scoreSpec: jsonb("score_spec").notNull(),
    scoreDirection: text("score_direction").notNull(),
    /** The SummarySpec stored by this teach; NULL when none was taught. */
    summarySpec: jsonb("summary_spec"),
    /** The share the teacher taught from — forensic context for the spec. */
    exampleRaw: text("example_raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    gameCreatedIdx: index("game_spec_revisions_game_created_idx").on(t.gameId, t.createdAt),
  }),
);

/**
 * "My Games" — a per-user ordered selection of catalog games. Same sparse
 * `position` scheme as `items.position` (see `lib/positions.ts` /
 * `lib/gamePositions.ts`); NULL positions sort last until first dragged.
 */
export const userGames = pgTable(
  "user_games",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    position: integer("position"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.gameId] }),
    userPositionIdx: index("user_games_user_position_idx").on(t.userId, t.position),
  }),
);

/**
 * Per-user cached Letterboxd watchlist (Letterboxd-match lists). Replaced
 * wholesale on each watchlist sync; rows are keyed by the canonical
 * Letterboxd film slug, which is stable across users — overlap between
 * members is a slug-equality join, no TMDB enrichment needed until a film
 * actually enters a list.
 */
export const letterboxdWatchlistFilms = pgTable(
  "letterboxd_watchlist_films",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filmSlug: text("film_slug").notNull(),
    /** Display title as scraped from the watchlist page (may be null on odd markup). */
    title: text("title"),
    year: integer("year"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.filmSlug] }),
    slugIdx: index("letterboxd_watchlist_films_slug_idx").on(t.filmSlug),
  }),
);

/**
 * Per-member acceptance of a suggested item (Letterboxd-match lists). The
 * suggester gets a row at suggest time; the first row from a *different*
 * member promotes the item out of `suggestion_state = 'pending'`. Rows are
 * kept after promotion — they power the "who's in" badge, and the watchlist
 * cache join verifies whether the member actually added the film on
 * Letterboxd.
 */
export const itemAcceptances = pgTable(
  "item_acceptances",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemId, t.userId] }),
  }),
);

/**
 * Scores for daily games. One row per (game, user, period_key); `period_key`
 * is the puzzle day ("YYYY-MM-DD"). Games-tab posts write here directly, and
 * migrated Lists leaderboard items translate their legacy `item_id` into
 * `game_id` before reading or writing scores. The primary key enforces one
 * score per user per game per day.
 */
export const gameScores = pgTable(
  "game_scores",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    scoreValue: numeric("score_value"),
    scoreRaw: text("score_raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.gameId, t.userId, t.periodKey] }),
    gamePeriodIdx: index("game_scores_game_period_idx").on(t.gameId, t.periodKey),
  }),
);

/**
 * Emoji reactions on a daily-game score (G2c). A reaction targets one score —
 * identified by `(game_id, score_user_id, period_key)`, the `game_scores` PK —
 * and carries the `reactor_user_id` plus their chosen `emoji`. The composite PK
 * enforces the tapback model: at most one reaction per reactor per score
 * (re-reacting replaces the emoji via upsert). The composite FK to
 * `game_scores` keeps reactions from outliving the score they decorate (and
 * cascades when the score's game or owner is deleted); a separate FK cascades
 * on reactor deletion. Reads are gated to the viewer's friend graph in the
 * route layer, not here.
 */
export const gameScoreReactions = pgTable(
  "game_score_reactions",
  {
    gameId: uuid("game_id").notNull(),
    periodKey: text("period_key").notNull(),
    scoreUserId: uuid("score_user_id").notNull(),
    reactorUserId: uuid("reactor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.gameId, t.periodKey, t.scoreUserId, t.reactorUserId],
    }),
    scoreFk: foreignKey({
      columns: [t.gameId, t.scoreUserId, t.periodKey],
      foreignColumns: [gameScores.gameId, gameScores.userId, gameScores.periodKey],
      name: "game_score_reactions_score_fk",
    }).onDelete("cascade"),
    scoreIdx: index("game_score_reactions_score_idx").on(t.gameId, t.periodKey, t.scoreUserId),
  }),
);

/**
 * Per-user, per-day "play with me" share links — the Games-tab copy-scores
 * CTA (`/g/:token`). One row per (user, UTC day): minting is idempotent within
 * a day and rotates to a fresh token the next day. The token resolves to the
 * sharer; the `/g/:token` landing routes a viewer who's already friends (or the
 * sharer themselves) straight to the Games home, and everyone else to the
 * sharer's profile (where they can add them). Unlike a `friend_requests` share
 * link this is **not** an accept surface — opening one never forms an edge on
 * its own. Old days' tokens keep resolving so already-shared links never break.
 */
export const gameShareLinks = pgTable(
  "game_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dateKey: text("date_key").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    userDateUniq: uniqueIndex("game_share_links_user_date_idx").on(t.userId, t.dateKey),
  }),
);

/**
 * Symmetric friend graph (spec §3.6, G2a). One row per unordered pair,
 * stored canonically as `user_low < user_high` (enforced in
 * `lib/friends.ts`, the only writer). Lookups for either side stay indexed:
 * the PK covers `user_low`, `friendships_high_idx` covers `user_high`.
 */
export const friendships = pgTable(
  "friendships",
  {
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userLow, t.userHigh] }),
    highIdx: index("friendships_high_idx").on(t.userHigh),
  }),
);

/**
 * Friend invites — two row shapes share this table, discriminated by
 * `invitee_id`:
 *
 * - **Share-link invite** (`invitee_id IS NULL`, `token` set): reusable
 *   personal link (spec §3.4) — anyone who opens it can accept and form a
 *   `friendships` edge with the inviter, any number of times. One stable
 *   row per inviter; `POST /v1/friends/invite` reuses it.
 * - **Directed request** (`invitee_id` set, `token` NULL): a user-to-user
 *   friend request (mutuals / profile-page flow). Rows exist only while
 *   pending — accept forms the edge and deletes the row; deny/cancel
 *   deletes it silently (re-requesting is allowed). The partial unique
 *   index keeps one pending request per (inviter, invitee).
 *
 * Either way `friendships` is the source of truth for edges. `status` /
 * `responded_at` are legacy from the original single-use link model: kept
 * for old rows, and directed rows only ever exist as `pending`.
 */
export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").unique(),
    inviteeId: uuid("invitee_id").references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    inviteeIdx: index("friend_requests_invitee_idx").on(t.inviteeId),
    directedPendingUniq: uniqueIndex("friend_requests_directed_pending_idx")
      .on(t.inviterId, t.inviteeId)
      .where(sql`invitee_id IS NOT NULL AND status = 'pending'`),
  }),
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bucketKey, t.windowStart] }),
  }),
);

export type DbUser = typeof users.$inferSelect;
export type DbUserIdentity = typeof userIdentities.$inferSelect;
export type DbAuthSession = typeof authSessions.$inferSelect;
export type DbList = typeof lists.$inferSelect;
export type DbListMember = typeof listMembers.$inferSelect;
export type DbListInvite = typeof listInvites.$inferSelect;
export type DbItem = typeof items.$inferSelect;
export type DbItemTag = typeof itemTags.$inferSelect;
export type DbListSavedView = typeof listSavedViews.$inferSelect;
export type DbActivityEvent = typeof activityEvents.$inferSelect;
export type DbUserActivityRead = typeof userActivityReads.$inferSelect;
export type DbMetadataCache = typeof metadataCache.$inferSelect;
export type DbRateLimit = typeof rateLimits.$inferSelect;
export type DbListSource = typeof listSources.$inferSelect;
export type DbGame = typeof games.$inferSelect;
export type DbFriendship = typeof friendships.$inferSelect;
export type DbFriendRequest = typeof friendRequests.$inferSelect;
export type DbUserGame = typeof userGames.$inferSelect;
export type DbGameScore = typeof gameScores.$inferSelect;
export type DbGameShareLink = typeof gameShareLinks.$inferSelect;
export type DbLetterboxdWatchlistFilm = typeof letterboxdWatchlistFilms.$inferSelect;
export type DbItemAcceptance = typeof itemAcceptances.$inferSelect;
