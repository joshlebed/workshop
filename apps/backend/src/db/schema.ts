import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const listTypeEnum = pgEnum("list_type", ["movie", "tv", "book", "date_idea", "trip"]);

export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);

export const authProviderEnum = pgEnum("auth_provider", ["apple", "google"]);

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "list_created",
  "member_joined",
  "member_left",
  "member_removed",
  "item_added",
  "item_updated",
  "item_deleted",
  "item_upvoted",
  "item_unupvoted",
  "item_completed",
  "item_uncompleted",
  "invite_created",
  "invite_revoked",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProvider: authProviderEnum("auth_provider").notNull(),
    providerSub: text("provider_sub").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    providerSubIdx: uniqueIndex("users_provider_sub_idx").on(t.authProvider, t.providerSub),
  }),
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: listTypeEnum("type").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    color: text("color").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
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
    type: listTypeEnum("type").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    listIdx: index("items_list_idx").on(t.listId),
    listCompletedCreatedIdx: index("items_list_completed_created_idx").on(
      t.listId,
      t.completed,
      t.createdAt,
    ),
  }),
);

export const itemUpvotes = pgTable(
  "item_upvotes",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemId, t.userId] }),
    userIdx: index("item_upvotes_user_idx").on(t.userId),
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
    eventType: activityEventTypeEnum("event_type").notNull(),
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

// --- Spotify integration ---

// One row per (user, spotify_user). The encrypted refresh token (well, plain
// for now — a follow-up should wrap with KMS Encrypt/Decrypt) lives here so
// the backend can mint fresh access tokens transparently. `expires_at` lets
// the API client refresh proactively without burning a 401.
export const spotifyAccounts = pgTable("spotify_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  spotifyUserId: text("spotify_user_id").notNull(),
  spotifyDisplayName: text("spotify_display_name"),
  scope: text("scope").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// User-saved Spotify albums. The album payload is denormalised on save so the
// album list renders without round-tripping to Spotify on every paint. The
// canonical metadata also lives in `metadata_cache` keyed by source=spotify.
export const spotifyAlbumSaves = pgTable(
  "spotify_album_saves",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyAlbumId: text("spotify_album_id").notNull(),
    name: text("name").notNull(),
    artists: jsonb("artists").notNull().default(sql`'[]'::jsonb`),
    imageUrl: text("image_url"),
    releaseDate: text("release_date"),
    totalTracks: integer("total_tracks"),
    spotifyUrl: text("spotify_url"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.spotifyAlbumId] }),
    userCreatedIdx: index("spotify_album_saves_user_created_idx").on(t.userId, t.createdAt),
  }),
);

// OAuth state cache for the Authorization Code + PKCE flow. The verifier
// can't ride the redirect (Spotify echoes back only `state`), so we store
// it server-side keyed by `state`. Rows are best-effort short-lived; the
// callback also enforces an `expires_at` check.
export const spotifyOauthStates = pgTable("spotify_oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeVerifier: text("code_verifier").notNull(),
  appRedirect: text("app_redirect"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type DbUser = typeof users.$inferSelect;
export type DbList = typeof lists.$inferSelect;
export type DbListMember = typeof listMembers.$inferSelect;
export type DbListInvite = typeof listInvites.$inferSelect;
export type DbItem = typeof items.$inferSelect;
export type DbItemUpvote = typeof itemUpvotes.$inferSelect;
export type DbActivityEvent = typeof activityEvents.$inferSelect;
export type DbUserActivityRead = typeof userActivityReads.$inferSelect;
export type DbMetadataCache = typeof metadataCache.$inferSelect;
export type DbRateLimit = typeof rateLimits.$inferSelect;
export type DbSpotifyAccount = typeof spotifyAccounts.$inferSelect;
export type DbSpotifyAlbumSave = typeof spotifyAlbumSaves.$inferSelect;
export type DbSpotifyOauthState = typeof spotifyOauthStates.$inferSelect;
