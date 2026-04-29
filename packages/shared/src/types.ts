// v2 skeleton. Endpoint-specific request/response shapes are added in the
// phase that introduces the endpoint (see docs/redesign-plan.md).
//
// `SHARED_TYPES_VERSION` lives in `./constants.ts` so the mobile bundle can
// import it at runtime via `@workshop/shared/constants` without dragging the
// type barrel through Metro. Bump it on any breaking edit to a request/
// response type below.

export type AuthProvider = "apple" | "google";

export type ListType = "movie" | "tv" | "book" | "date_idea" | "trip" | "album_shelf";

export type MemberRole = "owner" | "member";

export type ActivityEventType =
  | "list_created"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "item_added"
  | "item_updated"
  | "item_deleted"
  | "item_upvoted"
  | "item_unupvoted"
  | "item_completed"
  | "item_uncompleted"
  | "invite_created"
  | "invite_revoked"
  | "album_shelf_refreshed"
  | "album_shelf_source_changed"
  | "album_promoted"
  | "album_demoted";

export interface User {
  id: string;
  authProvider: AuthProvider;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Me {
  user: User;
}

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL";

export interface ApiErrorResponse {
  error: string;
  code: ErrorCode;
  details?: unknown;
}

// --- Auth (Phase 0b) ---

export interface AppleAuthRequest {
  identityToken: string;
  nonce?: string;
  /**
   * Apple returns email/name only on the *first* sign-in. Web SDKs surface
   * them on the JS callback; iOS surfaces them on `ASAuthorizationAppleIDCredential`.
   * The client forwards both so the backend can persist them on initial upsert.
   */
  email?: string;
  fullName?: string;
}

export interface GoogleAuthRequest {
  idToken: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  needsDisplayName: boolean;
}

export interface UpdateMeRequest {
  displayName: string;
}

// --- Lists (Phase 1a-1) ---

/**
 * Palette keys for list color tokens. The backend treats these as opaque
 * strings; the client maps each key to a hex value via `tokens.list[key]`.
 * See `apps/workshop/src/ui/theme.ts` and `docs/redesign-plan.md` §9.
 */
export type ListColor = "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";

/**
 * Free-form per-list-type JSONB blob. For `album_shelf`, the shape is
 * `AlbumShelfListMetadata` (see below); other list types currently store `{}`.
 */
export type ListMetadata = Record<string, unknown>;

export interface List {
  id: string;
  type: ListType;
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  ownerId: string;
  metadata: ListMetadata;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape returned by `GET /v1/lists` — the home-screen card. Includes the
 * requesting user's role on the list plus aggregate counts so the client can
 * render a list card without an extra round-trip.
 */
export interface ListSummary extends List {
  role: MemberRole;
  itemCount: number;
  memberCount: number;
}

export interface ListMemberSummary {
  userId: string;
  displayName: string | null;
  role: MemberRole;
  joinedAt: string;
}

/**
 * `GET /v1/lists/:id` returns one of these per still-pending invite (not
 * yet accepted, not revoked, not expired). Email invites are explicitly
 * deferred — `email` is always `null` in v1; the field is kept on the
 * shape so the schema doesn't churn if email invites land later.
 */
export interface PendingInvite {
  id: string;
  email: string | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateListRequest {
  type: ListType;
  name: string;
  emoji: string;
  color: ListColor;
  description?: string;
  /**
   * Required iff `type === "album_shelf"`. Public Spotify playlist URL
   * (`open.spotify.com/playlist/<id>` or `spotify:playlist:<id>`).
   */
  spotifyPlaylistUrl?: string;
}

export interface UpdateListRequest {
  name?: string;
  emoji?: string;
  color?: ListColor;
  /** Pass `null` to clear; omit to leave unchanged. */
  description?: string | null;
  /**
   * Mutable per-list-type blob. For `album_shelf`, only
   * `spotifyPlaylistUrl` is client-settable; the backend re-parses the id,
   * persists, and triggers a refresh.
   */
  metadata?: ListMetadata;
}

export interface ListListResponse {
  lists: ListSummary[];
}

export interface ListResponse {
  list: List;
}

export interface ListDetailResponse {
  list: List;
  members: ListMemberSummary[];
  pendingInvites: PendingInvite[];
}

// --- Items (Phase 1a-2) ---

/**
 * `metadata` is per-list-type free-form JSONB in v1; Phase 2 adds per-type
 * Zod validators (poster URL for movies, OG image for date ideas, etc.) at
 * the API boundary. Keep it loose here so the type doesn't churn when the
 * validators land.
 */
export type ItemMetadata = Record<string, unknown>;

export interface Item {
  id: string;
  listId: string;
  type: ListType;
  title: string;
  url: string | null;
  note: string | null;
  metadata: ItemMetadata;
  addedBy: string;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  /** Aggregate count from `item_upvotes`. New items always start at 1 (creator's auto-upvote). */
  upvoteCount: number;
  /** True when the requesting user has upvoted this item. */
  hasUpvoted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemRequest {
  title: string;
  url?: string;
  note?: string;
  metadata?: ItemMetadata;
}

export interface UpdateItemRequest {
  title?: string;
  /** Pass `null` to clear; omit to leave unchanged. */
  url?: string | null;
  /** Pass `null` to clear; omit to leave unchanged. */
  note?: string | null;
  metadata?: ItemMetadata;
}

export interface ItemListResponse {
  items: Item[];
}

export interface ItemResponse {
  item: Item;
}

// --- Invites + members (Phase 3a-1) ---
//
// v1 ships share-link invites only — `email` is always `null` on the
// returned shape. Tokens are 32-byte URL-safe base64 with a 7-day
// `expiresAt`; the owner can revoke at any time. `accept` requires an
// authenticated user and is idempotent (re-accepting a still-valid
// token while already a member is a no-op).

export interface Invite {
  id: string;
  listId: string;
  email: string | null;
  /**
   * Token is only returned to the inviter on `POST /v1/lists/:id/invites`
   * so they can build the share URL. Subsequent reads (`pendingInvites`
   * on `GET /v1/lists/:id`) omit it — exposing it on every list-detail
   * fetch would leak the token to non-owners.
   */
  token?: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/**
 * Body of `POST /v1/lists/:id/invites`. `email` is reserved for a future
 * email-invite flow; v1 ignores it (always treats the request as
 * share-link-only) so the field doesn't churn when email invites land.
 */
export interface CreateInviteRequest {
  email?: string | null;
}

export interface InviteResponse {
  invite: Invite;
}

/**
 * `POST /v1/invites/:token/accept` returns the joined list and the
 * member row that was created (or already existed). Idempotent on
 * re-accept while already a member.
 */
export interface AcceptInviteResponse {
  list: List;
  member: ListMemberSummary;
}

/**
 * `DELETE /v1/lists/:id/members/:userId` shape — owner-removes-anyone or
 * non-owner-self-leaves. Returned `{ ok: true }` on success.
 */
export interface MemberRemoveResponse {
  ok: true;
}

// --- Search + enrichment (Phase 2a-1) ---
//
// Backend proxies TMDB / Google Books behind SSM-sourced API keys and
// normalizes responses into the shapes below. See spec §9.

export type MediaSearchType = "movie" | "tv";

/** Normalized TMDB row. `id` is the TMDB id stringified. */
export interface MediaResult {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  runtimeMinutes?: number;
  overview: string | null;
}

/** Normalized Google Books volume. `id` is the Google Books volume id. */
export interface BookResult {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  coverUrl: string | null;
  pageCount?: number;
  description?: string;
}

export interface MediaSearchResponse {
  results: MediaResult[];
}

export interface BookSearchResponse {
  results: BookResult[];
}

// --- Per-type item metadata (Phase 2a-1, spec §9.4) ---
//
// Validated at the API boundary on POST/PATCH /v1/items based on the parent
// list's `type`. Every field is optional so manual entries (no provider
// match) and provider-enriched entries share the same JSONB shape.

export interface MovieMetadata {
  source?: "tmdb" | "manual";
  sourceId?: string;
  posterUrl?: string;
  year?: number;
  runtimeMinutes?: number;
  overview?: string;
}

export type TvMetadata = MovieMetadata;

export interface BookMetadata {
  source?: "google_books" | "manual";
  sourceId?: string;
  coverUrl?: string;
  authors?: string[];
  year?: number;
  pageCount?: number;
  description?: string;
}

export interface PlaceMetadata {
  source?: "link_preview" | "manual";
  sourceId?: string;
  image?: string;
  siteName?: string;
  title?: string;
  description?: string;
  lat?: number;
  lng?: number;
}

// --- Link preview (Phase 2a-2) ---

/**
 * Normalized OG / Twitter card scrape from `GET /v1/link-preview?url=`.
 * `image` is resolved to an absolute URL relative to `finalUrl` so the
 * client can render it directly. `siteName` falls back to the host of
 * `finalUrl` when the page omits `og:site_name`.
 */
export interface LinkPreview {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  fetchedAt: string;
}

export interface LinkPreviewResponse {
  preview: LinkPreview;
}

// --- Activity feed (Phase 3a-2) ---
//
// Cross-list chronological feed of events on lists the requester is a
// member of (spec §4.7). Events are recorded synchronously by mutating
// handlers via `recordEvent` (`apps/backend/src/lib/events.ts`); the
// `activity_event_type` enum lives in `db/schema.ts` and is the
// canonical set.

export interface ActivityEvent {
  id: string;
  listId: string;
  actorId: string;
  /** Joined from `users.display_name`; null when the actor has none yet. */
  actorDisplayName: string | null;
  type: ActivityEventType;
  /** Set on item-scoped events; null on list/member/invite events. */
  itemId: string | null;
  /** Event-specific details (e.g. item title at the time of the event). */
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Opaque cursor for `GET /v1/activity?cursor=...`. Encodes `(createdAt, id)`
 * so events recorded inside the same transaction don't get duplicated or
 * skipped at the page boundary. Clients should treat the value as opaque.
 */
export interface ActivityFeedResponse {
  events: ActivityEvent[];
  nextCursor: string | null;
}

/**
 * `POST /v1/activity/read`. Omit `listIds` to mark every list the user is
 * a member of as read. Pass a subset to mark only those (the backend
 * silently skips lists the user isn't a member of).
 */
export interface MarkActivityReadRequest {
  listIds?: string[];
}

export interface MarkActivityReadResponse {
  ok: true;
}

// --- Album Shelf (post-redesign feature, see docs/album-shelf.md) ---

/**
 * Stored on `lists.metadata` for `type === "album_shelf"` rows. Other types
 * leave `metadata` empty.
 */
export interface AlbumShelfListMetadata {
  spotifyPlaylistUrl: string;
  spotifyPlaylistId: string;
  /** Updated each time a member runs a refresh. Null until the first refresh. */
  lastRefreshedAt: string | null;
  lastRefreshedBy: string | null;
}

/**
 * Stored on `items.metadata` for `type === "album_shelf"` rows. `position`
 * decides which section the row renders in: `null` → detected (sorted by
 * `detectedAt` ASC), non-null → ordered (sorted by `position` ASC).
 */
export interface AlbumShelfItemMetadata {
  source: "spotify";
  spotifyAlbumId: string;
  spotifyAlbumUrl: string;
  title: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  trackCount: number;
  position: number | null;
  detectedAt: string;
}

/**
 * Response for `GET /v1/lists/:id/items` when the list is an album_shelf.
 * Other list types continue to return `{ items: Item[] }`.
 */
export interface AlbumShelfItemsResponse {
  ordered: Item[];
  detected: Item[];
}

export interface AlbumShelfRefreshResponse {
  ordered: Item[];
  detected: Item[];
  refreshedAt: string;
  refreshedBy: string;
  /** Number of new detected items added in this refresh (may be 0). */
  addedCount: number;
}
