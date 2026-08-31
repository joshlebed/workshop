import { apiRequest } from "@workshop/api-client/api";
import type { UserFlagsResponse } from "@workshop/shared/games";

/**
 * Durable per-user flags (`user_flags`) — cross-device client state like
 * announcement dismissals, plus server-authored adoption markers (see
 * `USER_FLAG_KEYS` in `@workshop/shared/constants`). Small map, one fetch.
 */
export function fetchMyFlags(token: string | null): Promise<UserFlagsResponse> {
  return apiRequest<UserFlagsResponse>({ method: "GET", path: "/v1/users/me/flags", token });
}

export function setMyFlag(
  key: string,
  value: unknown,
  token: string | null,
): Promise<{ key: string; value: unknown }> {
  return apiRequest<{ key: string; value: unknown }>({
    method: "PUT",
    path: `/v1/users/me/flags/${encodeURIComponent(key)}`,
    body: { value },
    token,
  });
}
