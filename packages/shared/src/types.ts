// v2 skeleton. Endpoint-specific request/response shapes are added in the
// phase that introduces the endpoint (see docs/redesign-plan.md).

export type AuthProvider = "apple" | "google";

export type ListType = "movie" | "tv" | "book" | "date_idea" | "trip";

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
  | "invite_revoked";

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

export interface List {
  id: string;
  type: ListType;
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  ownerId: string;
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
}

export interface UpdateListRequest {
  name?: string;
  emoji?: string;
  color?: ListColor;
  /** Pass `null` to clear; omit to leave unchanged. */
  description?: string | null;
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

// --- Spotify integration ---

/**
 * Public-facing Spotify connection state. `connected: false` means the user
 * has never linked an account or revoked access. The mobile/web app uses
 * this to decide whether to render the "Connect Spotify" CTA or the rest of
 * the Spotify UI.
 */
export interface SpotifyConnectionStatus {
  connected: boolean;
  spotifyUserId: string | null;
  spotifyDisplayName: string | null;
  scope: string | null;
  connectedAt: string | null;
}

export interface SpotifyAuthorizeResponse {
  /** Browser-openable Spotify consent URL with PKCE challenge already attached. */
  authorizeUrl: string;
  /** Opaque correlation id; clients can ignore but it's logged for debugging. */
  state: string;
}

export interface SpotifyAlbumSummary {
  spotifyAlbumId: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  releaseDate: string | null;
  totalTracks: number | null;
  spotifyUrl: string | null;
}

/** A saved album row, including the per-user note + save timestamp. */
export interface SavedAlbum extends SpotifyAlbumSummary {
  note: string | null;
  savedAt: string;
}

export interface SavedAlbumListResponse {
  albums: SavedAlbum[];
}

export interface SavedAlbumResponse {
  album: SavedAlbum;
}

export interface SpotifyAlbumSearchResponse {
  query: string;
  results: SpotifyAlbumSummary[];
}

export interface SaveAlbumRequest {
  spotifyAlbumId: string;
  note?: string;
}

export interface UpdateSavedAlbumRequest {
  /** Pass `null` to clear; omit to leave unchanged. */
  note?: string | null;
}

/** Trimmed subset of the Spotify track shape the app actually renders. */
export interface SpotifyTrackSummary {
  spotifyTrackId: string;
  name: string;
  durationMs: number;
  artists: string[];
  album: {
    spotifyAlbumId: string;
    name: string;
    imageUrl: string | null;
  };
  spotifyUrl: string | null;
}

export interface SpotifyNowPlaying {
  isPlaying: boolean;
  progressMs: number | null;
  track: SpotifyTrackSummary | null;
}

export interface SpotifyRecentListen {
  playedAt: string;
  track: SpotifyTrackSummary;
}

export interface SpotifyRecentListensResponse {
  items: SpotifyRecentListen[];
}

export interface SpotifyPlaylistSummary {
  spotifyPlaylistId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  ownerDisplayName: string | null;
  trackCount: number;
  spotifyUrl: string | null;
}

export interface SpotifyPlaylistListResponse {
  playlists: SpotifyPlaylistSummary[];
}

export interface SpotifyPlaylistTracksResponse {
  playlistId: string;
  total: number;
  tracks: SpotifyTrackSummary[];
}

/**
 * Result of "syncing" a Spotify playlist into the user's saved albums:
 * every unique album that appears across the playlist's tracks is added.
 */
export interface SyncPlaylistAlbumsResponse {
  playlistId: string;
  uniqueAlbumCount: number;
  newlySavedCount: number;
  alreadySavedCount: number;
  albums: SavedAlbum[];
}
