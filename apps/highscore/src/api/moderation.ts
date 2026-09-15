// Block + report wrappers (App Store Review Guideline 1.2). HighScore-owned —
// Workshop has no moderation surface yet, so nothing here is shared.

import { apiRequest } from "@workshop/api-client/api";
import type {
  BlockedUsersResponse,
  CreateReportRequest,
  CreateReportResponse,
} from "@workshop/shared/moderation";

export function blockUser(userId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "POST",
    path: `/v1/users/${encodeURIComponent(userId)}/block`,
    token,
  });
}

export function unblockUser(userId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/users/${encodeURIComponent(userId)}/block`,
    token,
  });
}

export function fetchBlockedUsers(token: string | null): Promise<BlockedUsersResponse> {
  return apiRequest<BlockedUsersResponse>({ method: "GET", path: "/v1/users/me/blocks", token });
}

export function createReport(
  body: CreateReportRequest,
  token: string | null,
): Promise<CreateReportResponse> {
  return apiRequest<CreateReportResponse>({ method: "POST", path: "/v1/reports", token, body });
}

export const blockedUsersQueryKey = ["users", "me", "blocks"] as const;
