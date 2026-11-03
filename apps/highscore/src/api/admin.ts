import { apiRequest } from "@workshop/api-client/api";
import type {
  AdminAnalyticsResponse,
  AdminGraphResponse,
  AdminPushRecipientsResponse,
  AdminPushSendRequest,
  AdminPushSendResponse,
} from "@workshop/shared";
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

/** Users with a push token, filtered by name/email substring (403 for non-admins). */
export function fetchAdminPushRecipients(
  token: string | null,
  q: string,
  remindersOnly: boolean,
): Promise<AdminPushRecipientsResponse> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (remindersOnly) params.set("remindersOnly", "1");
  const qs = params.toString();
  return apiRequest<AdminPushRecipientsResponse>({
    method: "GET",
    path: `/v1/admin/push/recipients${qs ? `?${qs}` : ""}`,
    token,
  });
}

/**
 * The operator's push send. Only the admin dashboard's Push tab calls this,
 * after the operator types SEND in the confirm sheet — never automation, never
 * an agent (docs/push-runbook.md).
 */
export function sendAdminPush(
  token: string | null,
  body: AdminPushSendRequest,
): Promise<AdminPushSendResponse> {
  return apiRequest<AdminPushSendResponse>({
    method: "POST",
    path: "/v1/admin/push/send",
    token,
    body,
  });
}
