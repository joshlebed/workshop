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
  | "item_added"
  | "item_updated"
  | "item_archived"
  | "item_upvoted"
  | "item_unupvoted"
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
  | "source_synced";

export interface User {
  id: string;
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

export interface UpdateMeRequest {
  displayName: string;
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

export interface PendingInvite {
  id: string;
  email: string | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string | null;
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
  pendingInvites: PendingInvite[];
  sources: ListSource[];
}

// --- Items ---

export interface Item {
  id: string;
  listId: string;
  kind: ItemKind;
  title: string;
  url: string | null;
  note: string | null;
  content: ItemContent;
  position: number | null;
  addedBy: string;
  /**
   * `completed*` fields are gated by the `todo` module on the parent list —
   * the backend omits them from list/item reads when `todo` is off. They're
   * preserved in the DB so re-enabling the module restores the prior state.
   */
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  upvoteCount: number;
  viewerUpvoted: boolean;
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

export interface ListItemsResponse {
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
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

export type SourcePreview = SpotifyPlaylistPreview | LetterboxdListPreview;

export interface SourcePreviewResponse {
  preview: SourcePreview;
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

// --- Invites + members ---

export interface Invite {
  id: string;
  listId: string;
  email: string | null;
  token?: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface CreateInviteRequest {
  email?: string | null;
}

export interface InviteResponse {
  invite: Invite;
}

export interface AcceptInviteResponse {
  list: List;
  member: ListMemberSummary;
}

export interface MemberRemoveResponse {
  ok: true;
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

// --- Upvotes ---

export interface ItemUpvoteResponse {
  item: Item;
}
