// v2 skeleton. Endpoint-specific request/response shapes are added in the
// phase that introduces the endpoint.
//
// `SHARED_TYPES_VERSION` lives in `./constants.ts` so the mobile bundle can
// import it at runtime via `@workshop/shared/constants` without dragging the
// type barrel through Metro. Bump it on any breaking edit to a request/
// response type below.

import type { ItemContent, ItemKind } from "./itemKinds.js";
import type { ConfigWarning, ModuleName } from "./modules.js";
import type { SourceKind } from "./sourceKinds.js";
import type { ListColor } from "./templates.js";

export type { ItemContent, ItemKind } from "./itemKinds.js";
export type { ConfigWarning, ModuleName } from "./modules.js";
export type { SourceKind } from "./sourceKinds.js";
export type { ListColor } from "./templates.js";

export type AuthProvider = "apple" | "google";

export type MemberRole = "owner" | "member";

/**
 * Per-list share-link visibility. Controls who can do what at `/l/:slug`:
 *  - `off`  → slug 404s for non-members; existing members still access via
 *             home / direct UUID URL.
 *  - `view` → anyone with the link can read the list (no write access).
 *  - `join` → anyone with the link can join as a member.
 *
 * Defaults to `join` (backwards-compatible with the legacy invite flow).
 */
export type ShareVisibility = "off" | "view" | "join";

// Activity event types are a plain string at the API boundary so adding a new
// type is code-only — no Postgres `ALTER TYPE` ceremony. The legacy event
// types (`album_shelf_refreshed`, `album_shelf_source_changed`,
// `album_promoted`, `album_demoted`, `item_deleted`) were migrated in place
// to their post-redesign equivalents in 0014; verify with
// `SELECT DISTINCT event_type FROM activity_events;` on prod before relying
// on the trimmed union.
export type ActivityEventType =
  | "list_created"
  | "list_archived"
  | "list_duplicated"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "owner_transferred"
  | "item_added"
  | "item_updated"
  | "item_archived"
  | "item_tagged"
  | "item_completed"
  | "item_uncompleted"
  | "item_promoted"
  | "item_demoted"
  | "invite_created"
  | "invite_revoked"
  | "module_enabled"
  | "module_disabled"
  | "source_added"
  | "source_removed"
  | "source_updated"
  | "source_synced"
  | "item_suggested"
  | "suggestion_accepted";

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  /** Base64 `data:` URL of the profile picture, or null when using initials. */
  avatarUrl: string | null;
  /**
   * Account-level Letterboxd username — set once in settings, reused by
   * every Letterboxd-match list the user is a member of. `null` = not
   * connected.
   */
  letterboxdUsername: string | null;
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

// --- Auth ---

export interface AppleAuthRequest {
  identityToken: string;
  nonce?: string;
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

/**
 * Partial profile update. Both fields are optional and updated independently —
 * send only what changed. `avatarUrl: null` clears the profile picture; omitting
 * a field leaves it untouched.
 */
export interface UpdateMeRequest {
  displayName?: string;
  avatarUrl?: string | null;
}

// --- Lists ---

export interface List {
  id: string;
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  coverPhotoUrl: string | null;
  ownerId: string;
  /**
   * Constrains the kind of items the list accepts. `null` = unconstrained
   * (the Blank List escape hatch); any item kind is allowed.
   */
  itemKind: ItemKind | null;
  modules: ModuleName[];
  /**
   * 8-char base62 slug used in the share URL (`/l/:shareSlug`). Owner can
   * rotate it via `POST /v1/lists/:id/share/reset`; the old slug 404s
   * immediately.
   */
  shareSlug: string;
  /** Who can do what at `/l/:shareSlug`. See `ShareVisibility`. */
  shareVisibility: ShareVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface ListSource {
  id: string;
  listId: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  lastSyncedBy: string | null;
  createdAt: string;
}

export interface ListSummary extends List {
  role: MemberRole;
  itemCount: number;
  memberCount: number;
  unreadCount: number;
  pinnedAt: string | null;
  archivedAt: string | null;
  mutedAt: string | null;
}

export interface ListMemberSummary {
  userId: string;
  displayName: string | null;
  role: MemberRole;
  joinedAt: string;
}

export interface CreateListRequest {
  name: string;
  emoji: string;
  color: ListColor;
  description?: string;
  coverPhotoUrl?: string;
  itemKind: ItemKind | null;
  modules: ModuleName[];
  /**
   * Optional sources to attach at create time. Each source's config is
   * validated against its kind manifest; on commit, the source is created
   * and an initial sync runs synchronously.
   */
  sources?: Array<{ kind: SourceKind; config: Record<string, unknown> }>;
}

export interface UpdateListRequest {
  name?: string;
  emoji?: string;
  color?: ListColor;
  description?: string | null;
  coverPhotoUrl?: string | null;
  itemKind?: ItemKind | null;
  modules?: ModuleName[];
  /**
   * Required when removing a module that has associated data — echo back the
   * warning codes returned by `POST /v1/lists/:id/config-preview`. Without
   * it the server returns 409 with the warning list.
   */
  acknowledgedWarnings?: string[];
}

export interface ListListResponse {
  lists: ListSummary[];
}

export interface BulkCreateItemsRequest {
  items: Array<{
    title: string;
    url?: string;
    note?: string;
    kind?: ItemKind;
    content?: ItemContent;
  }>;
}

export interface BulkCreateItemsResponse {
  created: number;
  items: Item[];
}

export interface ListResponse {
  list: List;
}

export interface ListDetailResponse {
  list: List;
  members: ListMemberSummary[];
  sources: ListSource[];
}

/**
 * Safe metadata subset exposed at `GET /v1/lists/:id/preview` for users who
 * land on a list share URL without being a member yet. Mirrors the invite
 * preview shape (name/emoji/color/owner/counts) and deliberately omits any
 * member identities or item content — those are member-only. `viewer.isMember`
 * lets the client pick which landing-page CTA to render.
 */
export interface ListPreview {
  id: string;
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  ownerName: string | null;
  itemCount: number;
  memberCount: number;
  /** Per-kind label hint for OG / public landing (e.g. "Movie list"). Mirrors `lists.item_kind`. */
  itemKind: ItemKind | null;
  /** Module-name list — drives the secondary label ("Leaderboard" / "Checklist"). */
  modules: ModuleName[];
  /** Echoes the list's current share visibility. */
  shareVisibility: ShareVisibility;
  /** Stable share slug for the list. Owners see it in settings; clients can use it to canonicalize URLs. */
  shareSlug: string;
}

export interface ListPreviewResponse {
  preview: ListPreview;
  viewer: {
    authenticated: boolean;
    isMember: boolean;
  };
}

// --- Items ---

/** One member's acceptance of a suggested film (Letterboxd-match lists). */
export interface ItemAcceptance {
  userId: string;
  acceptedAt: string;
}

/**
 * Per-item Letterboxd-match state, present only when the parent list has the
 * `letterboxd` module enabled. Computed at read time against members' cached
 * watchlists — never stored on the item row — so overlap badges always
 * reflect the latest sync.
 */
export interface ItemLetterboxd {
  /** Member userIds whose Letterboxd watchlist currently contains this film. */
  watchlistOf: string[];
  /** True while the item is a pending suggestion (not yet accepted). */
  pending: boolean;
  /** Members who accepted the suggestion (includes the suggester). */
  acceptances: ItemAcceptance[];
}

export interface Item {
  id: string;
  listId: string;
  kind: ItemKind;
  title: string;
  url: string | null;
  note: string | null;
  content: ItemContent;
  position: number | null;
  /** Letterboxd-match state — only set when the list's `letterboxd` module is on. */
  letterboxd?: ItemLetterboxd;
  /**
   * Manual, kind-agnostic labels (spec §2.1) — normalized lowercase,
   * ≤40 chars, sorted alphabetically. Replaced as a set via
   * `PUT /v1/items/:id/tags`.
   */
  tags: string[];
  addedBy: string;
  /**
   * `completed*` fields are gated by the `todo` module on the parent list —
   * the backend omits them from list/item reads when `todo` is off. They're
   * preserved in the DB so re-enabling the module restores the prior state.
   */
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemRequest {
  kind: ItemKind;
  title: string;
  url?: string;
  note?: string;
  content?: ItemContent;
}

export interface UpdateItemRequest {
  kind?: ItemKind;
  title?: string;
  url?: string | null;
  note?: string | null;
  content?: ItemContent;
}

/**
 * `POST /v1/items/:id/move` — server computes the new `position` per the
 * sparse-integer allocator (§3.4 of the redesign). Both null → demote to
 * unordered (`position = NULL`). Only one of beforeItemId/afterItemId is
 * required; both → insert between.
 */
export interface MoveItemRequest {
  beforeItemId?: string | null;
  afterItemId?: string | null;
}

/**
 * `PUT /v1/items/:id/tags` — replaces the item's tag set wholesale. The
 * server normalizes each tag (trim, lowercase, collapse internal
 * whitespace) and dedupes; tags must be 1–40 chars after normalization.
 */
export interface UpdateItemTagsRequest {
  tags: string[];
}

/** One in-use tag on a list + how many non-archived items carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

/** `GET /v1/lists/:id/tags` — powers the filter-chip bar + editor suggestions. */
export interface ListTagsResponse {
  tags: TagCount[];
}

// --- Saved views (spec §2.3) ---

/**
 * A saved view's stored filter. `tags` are normalized lowercase tag names
 * (OR semantics, same as the live chip bar); `sort` is reserved for a future
 * sort control and round-tripped untouched today.
 */
export interface SavedViewConfig {
  tags: string[];
  sort?: string;
}

/**
 * A named, stored tag filter on a list (spec §2.3) — a one-tap preset like
 * "Burgers" inside "Date Ideas". Shared by every list member: any member
 * creates one; the creator or the list owner edits/removes it. `createdBy` is
 * null once the author has left the list (the shared view survives).
 */
export interface SavedView {
  id: string;
  listId: string;
  name: string;
  config: SavedViewConfig;
  createdBy: string | null;
  position: number | null;
  createdAt: string;
}

/** `GET /v1/lists/:id/views` — every saved view on the list, in display order. */
export interface SavedViewsResponse {
  views: SavedView[];
}

/** Single-view envelope returned by create/update. */
export interface SavedViewResponse {
  view: SavedView;
}

/** `POST /v1/lists/:id/views` — any member; the server assigns `position`. */
export interface CreateSavedViewRequest {
  name: string;
  config: SavedViewConfig;
}

/** `PATCH /v1/lists/:id/views/:viewId` — creator or list owner; partial. */
export interface UpdateSavedViewRequest {
  name?: string;
  config?: SavedViewConfig;
}

export interface ListItemsResponse {
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
  /**
   * Pending suggestions on Letterboxd-match lists (`letterboxd` module).
   * Empty on every other list — suggestions promote into ordered/unordered
   * once another member accepts.
   */
  suggested: Item[];
}

export interface ItemResponse {
  item: Item;
}

// --- List sources ---

export interface ListSourcesResponse {
  sources: ListSource[];
}

export interface CreateListSourceRequest {
  kind: SourceKind;
  config: Record<string, unknown>;
}

export interface ListSourceResponse {
  source: ListSource;
  addedCount?: number;
}

export interface SyncSourceResponse extends ListItemsResponse {
  source: ListSource;
  addedCount: number;
}

export interface SourcePreviewRequest {
  kind: SourceKind;
  config: Record<string, unknown>;
}

export interface SpotifyPlaylistPreview {
  kind: "spotify_playlist";
  playlistId: string;
  name: string;
  ownerName: string | null;
  trackCount: number;
}

export interface LetterboxdListPreview {
  kind: "letterboxd_list";
  username: string;
  slug: string;
  filmCount: number;
}

export interface LetterboxdMatchPreview {
  kind: "letterboxd_match";
}

export type SourcePreview = SpotifyPlaylistPreview | LetterboxdListPreview | LetterboxdMatchPreview;

export interface SourcePreviewResponse {
  preview: SourcePreview;
}

// --- Letterboxd match (letterboxd module) ---

/**
 * `PUT /v1/users/me/letterboxd` — connect (or change) the account-level
 * Letterboxd username. Accepts a bare username or a profile/watchlist URL;
 * the server normalizes, validates the watchlist is publicly reachable, and
 * runs an initial watchlist sync inline.
 */
export interface ConnectLetterboxdRequest {
  username: string;
}

export interface ConnectLetterboxdResponse {
  user: User;
  /** Films found on the public watchlist during the initial sync. */
  filmCount: number;
}

/** One list member's Letterboxd connection state. */
export interface LetterboxdMemberStatus {
  userId: string;
  displayName: string | null;
  /** `null` = this member hasn't connected a Letterboxd account yet. */
  letterboxdUsername: string | null;
  /** Cached watchlist size from the member's last sync (0 if never synced). */
  filmCount: number;
  /** When the member's watchlist cache was last refreshed. */
  syncedAt: string | null;
}

/** `GET /v1/lists/:id/letterboxd` — connection + sync status for the match list. */
export interface LetterboxdStatusResponse {
  members: LetterboxdMemberStatus[];
  /** The `letterboxd_match` source row to pass to the sync endpoint; null if missing. */
  sourceId: string | null;
  lastSyncedAt: string | null;
}

/**
 * `POST /v1/lists/:id/letterboxd/suggest` — bring a film from Letterboxd as
 * a suggestion. Must be a film URL (`letterboxd.com/film/<slug>/`).
 */
export interface SuggestFilmRequest {
  letterboxdUrl: string;
}

// --- Config preview / module changes ---

export interface ConfigPreviewRequest {
  modules?: ModuleName[];
  itemKind?: ItemKind | null;
}

export interface ConfigPreviewResponse {
  warnings: ConfigWarning[];
}

// --- Duplicate ---

export interface DuplicateListRequest {
  name?: string;
  emoji?: string;
  color?: ListColor;
  description?: string;
  modules?: ModuleName[];
  itemKind?: ItemKind | null;
  preserveCompletion?: boolean;
  copySources?: boolean;
}

// --- Members + sharing ---

export interface AcceptInviteResponse {
  list: List;
  member: ListMemberSummary;
}

export interface MemberRemoveResponse {
  ok: true;
}

/**
 * `PATCH /v1/lists/:id/share` — owner sets the link visibility. Slug isn't
 * editable here; rotate it via `POST /v1/lists/:id/share/reset`.
 */
export interface UpdateShareRequest {
  visibility: ShareVisibility;
}

/** Response payload for both share-update and share-reset endpoints. */
export interface ShareSettingsResponse {
  shareSlug: string;
  shareVisibility: ShareVisibility;
}

/** `POST /v1/lists/:id/members/:userId/promote` — atomically transfers ownership. */
export interface TransferOwnershipResponse {
  members: ListMemberSummary[];
}

// --- Search + enrichment ---

export type MediaSearchType = "movie" | "tv";

export interface MediaResult {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  runtimeMinutes?: number;
  overview: string | null;
}

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

// --- Link preview ---

export interface LinkPreview {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  /** Upstream image URL — verified reachable + content-type=image when present. */
  image: string | null;
  /**
   * CDN-proxied + resized variant of `image`. Clients prefer this for
   * rendering (smaller, always reachable, survives the upstream hotlink
   * blocking or going dark). `null` when there is no `image` to proxy.
   */
  imageProxy: string | null;
  favicon: string | null;
  siteName: string | null;
  /** Where the preview came from: oembed | site-handler | html. */
  source: "oembed" | "site" | "html";
  fetchedAt: string;
}

export interface LinkPreviewResponse {
  preview: LinkPreview;
}

// --- Activity feed ---

export interface ActivityEvent {
  id: string;
  listId: string;
  actorId: string;
  actorDisplayName: string | null;
  type: ActivityEventType;
  itemId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityFeedResponse {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export interface MarkActivityReadRequest {
  listIds?: string[];
}

export interface MarkActivityReadResponse {
  ok: true;
}

// --- Scores (leaderboard module, replaces game_scores) ---

export interface ItemScore {
  itemId: string;
  userId: string;
  /** YYYY-MM-DD calendar day, week key, or "all-time" — kind-agnostic bucket. */
  periodKey: string;
  scoreValue: number | null;
  scoreRaw: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertItemScoreRequest {
  periodKey: string;
  scoreRaw: string;
}

export interface ItemScoreResponse {
  score: ItemScore;
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  scoreRaw: string | null;
  scoreValue: number | null;
  updatedAt: string | null;
  /**
   * Server-computed ranking among players who posted a score for this period
   * (1 = best). Null for unplayed slots. Uses standard ("1224") rank with
   * ties getting the same rank; direction is per-item (`items.scoreDirection`,
   * 'desc' = higher is better, 'asc' = lower is better). Null when the
   * item has no `score_regex` configured (no reliable score parse).
   */
  rank: number | null;
}

export interface LeaderboardResponse {
  itemId: string;
  periodKey: string;
  entries: LeaderboardEntry[];
}

export interface ListScoresResponse {
  periodKey: string;
  scoresByItem: Record<string, LeaderboardEntry[]>;
}
