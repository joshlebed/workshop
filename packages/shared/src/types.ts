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
