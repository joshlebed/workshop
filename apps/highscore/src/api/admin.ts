import { apiRequest } from "@workshop/api-client/api";
import type { AdminAnalyticsResponse } from "@workshop/shared";
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
