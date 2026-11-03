// Daily-play reminder endpoints (`apps/backend/src/routes/v1/me.ts`).

import { apiRequest } from "@workshop/api-client/api";
import type {
  NotificationPrefsResponse,
  PushTokenMutationResponse,
  RegisterPushTokenRequest,
  UpdateNotificationPrefsRequest,
  UpdateNotificationPrefsResponse,
} from "@workshop/shared";

export function registerPushToken(
  token: string | null,
  body: RegisterPushTokenRequest,
): Promise<PushTokenMutationResponse> {
  return apiRequest<PushTokenMutationResponse>({
    method: "POST",
    path: "/v1/me/push-token",
    token,
    body,
  });
}

export function deletePushToken(
  token: string | null,
  expoPushToken: string,
): Promise<PushTokenMutationResponse> {
  return apiRequest<PushTokenMutationResponse>({
    method: "DELETE",
    path: "/v1/me/push-token",
    token,
    body: { expoPushToken },
  });
}

export function fetchNotificationPrefs(token: string | null): Promise<NotificationPrefsResponse> {
  return apiRequest<NotificationPrefsResponse>({
    method: "GET",
    path: "/v1/me/notification-prefs",
    token,
  });
}

export function saveNotificationPrefs(
  token: string | null,
  body: UpdateNotificationPrefsRequest,
): Promise<UpdateNotificationPrefsResponse> {
  return apiRequest<UpdateNotificationPrefsResponse>({
    method: "PUT",
    path: "/v1/me/notification-prefs",
    token,
    body,
  });
}
