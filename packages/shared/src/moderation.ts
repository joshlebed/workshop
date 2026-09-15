// Moderation surface (App Store Review Guideline 1.2) — shared types for user
// blocks and content reports. Type-only module exported via the `./moderation`
// subpath (like `./friends`).

/** What a report is about: the user's profile (name / photo) or one score post. */
export type ReportContentKind = "profile" | "score";

export type ReportReason = "abusive" | "offensive" | "spam" | "other";

/** `POST /v1/reports` */
export interface CreateReportRequest {
  targetUserId: string;
  contentKind: ReportContentKind;
  reason: ReportReason;
  /** Free text from the reporter (optional, ≤ 500 chars). */
  details?: string;
  /** Required when `contentKind === "score"`. */
  gameId?: string;
  periodKey?: string;
}

export interface CreateReportResponse {
  reportId: string;
}

/** `GET /v1/users/me/blocks` */
export interface BlockedUser {
  userId: string;
  displayName: string | null;
  blockedAt: string;
}

export interface BlockedUsersResponse {
  blocked: BlockedUser[];
}
