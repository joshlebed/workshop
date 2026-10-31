import { apiRequest } from "@workshop/api-client/api";
import type { AdminAnalyticsResponse, AdminGraphResponse } from "@workshop/shared";
import type { AdminAnalyticsRange, WorkshopClient } from "@workshop/shared/constants";

/** Admin-only dashboard numbers for one client app (403 for everyone else). */
export function fetchAdminAnalytics(
  token: string | null,
  client: WorkshopClient,
  rangeDays: AdminAnalyticsRange,
): Promise<AdminAnalyticsResponse> {
  return apiRequest<AdminAnalyticsResponse>({
    method: "GET",
    path: `/v1/admin/analytics?client=${client}&range=${rangeDays}`,
    token,
  });
}

/** Every HighScore user + friendship edge with per-user stats (403 for non-admins). */
export function fetchAdminGraph(token: string | null): Promise<AdminGraphResponse> {
  return apiRequest<AdminGraphResponse>({ method: "GET", path: "/v1/admin/graph", token });
}
