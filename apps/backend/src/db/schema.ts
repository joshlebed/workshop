import { sql } from "drizzle-orm";
import {
  boolean,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
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
  },
  (t) => ({
    ownerIdx: index("lists_owner_idx").on(t.ownerId),
    ownerUpdatedIdx: index("lists_owner_updated_idx").on(t.ownerId, t.updatedAt),
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
     * `item_scores.score_raw` to compute `score_value`. `scoreDirection`
     * controls leaderboard sort: 'desc' = higher is better (default),
     * 'asc' = lower is better (Wordle / Satle / etc.). Both are NULL on
     * non-game items. Currently DB-only — no client-facing surface to edit
     * them; backfilled by `apps/backend/scripts/backfill-score-regex.ts`
     * based on item URL / title.
     */
    scoreRegex: text("score_regex"),
    scoreDirection: text("score_direction"),
  },
  (t) => ({
    listIdx: index("items_list_idx").on(t.listId),
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
 * Generalizes the legacy `game_scores` table. One row per (item, user,
 * period_key); `period_key` is opaque ("YYYY-MM-DD" for daily games,
 * "YYYY-WNN" for weekly, "all-time" for one-off). `score_value` is the
 * parsed numeric when available so the leaderboard can sort; `score_raw`
 * preserves the original input (emojis, line breaks, etc.).
 */
export const itemScores = pgTable(
  "item_scores",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
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
    pk: primaryKey({ columns: [t.itemId, t.userId, t.periodKey] }),
    itemPeriodIdx: index("item_scores_item_period_idx").on(t.itemId, t.periodKey),
    userPeriodIdx: index("item_scores_user_period_idx").on(t.userId, t.periodKey),
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
export type DbList = typeof lists.$inferSelect;
export type DbListMember = typeof listMembers.$inferSelect;
export type DbListInvite = typeof listInvites.$inferSelect;
export type DbItem = typeof items.$inferSelect;
export type DbActivityEvent = typeof activityEvents.$inferSelect;
export type DbUserActivityRead = typeof userActivityReads.$inferSelect;
export type DbMetadataCache = typeof metadataCache.$inferSelect;
export type DbRateLimit = typeof rateLimits.$inferSelect;
export type DbListSource = typeof listSources.$inferSelect;
export type DbItemScore = typeof itemScores.$inferSelect;
