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
