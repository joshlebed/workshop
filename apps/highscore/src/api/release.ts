import { apiRequest } from "@workshop/api-client/api";
import type {
  AdminClientReleaseResponse,
  ClientReleaseResponse,
  UpdateClientReleaseRequest,
} from "@workshop/shared";
import type { ClientReleasePlatform } from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";

/** Public: the operator-set App Store update nudge (all nulls = none). */
export function fetchClientRelease(
  platform: ClientReleasePlatform,
): Promise<ClientReleaseResponse> {
  return apiRequest<ClientReleaseResponse>({
    method: "GET",
    path: `/v1/client/release?client=highscore&platform=${platform}`,
    token: null,
  });
}

/** Admin-only read of the nudge + who last changed it (403 for everyone else). */
export function fetchAdminClientRelease(
  token: string | null,
  platform: ClientReleasePlatform,
): Promise<AdminClientReleaseResponse> {
  return apiRequest<AdminClientReleaseResponse>({
    method: "GET",
    path: `/v1/admin/client-release?client=highscore&platform=${platform}`,
    token,
  });
}

/**
 * The operator's write. Only the admin dashboard's Release nudge form calls
 * this, on an explicit typed confirmation — never automation (runbook).
 */
export function saveAdminClientRelease(
  token: string | null,
  body: UpdateClientReleaseRequest,
): Promise<AdminClientReleaseResponse> {
  return apiRequest<AdminClientReleaseResponse>({
    method: "PUT",
    path: "/v1/admin/client-release",
    token,
    body,
  });
}

export function fetchUserFlags(token: string | null): Promise<UserFlagsResponse> {
  return apiRequest<UserFlagsResponse>({ method: "GET", path: "/v1/users/me/flags", token });
}

export function putUserFlag(token: string | null, key: string, value: unknown): Promise<unknown> {
  return apiRequest<unknown>({
    method: "PUT",
    path: `/v1/users/me/flags/${encodeURIComponent(key)}`,
    token,
    body: { value },
  });
}
