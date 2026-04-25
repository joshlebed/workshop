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
 * Reserved for Phase 3 — `GET /v1/lists/:id` returns it now as an empty array
 * so the response shape doesn't churn when invites land.
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
  lat?: number;
  lng?: number;
}
