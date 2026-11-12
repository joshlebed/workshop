import { apiRequest } from "@workshop/api-client/api";
import type { DeleteAccountResponse, ImpersonationTargetsResponse } from "@workshop/shared";

export function fetchImpersonationTargets(
  token: string | null,
): Promise<ImpersonationTargetsResponse> {
  return apiRequest<ImpersonationTargetsResponse>({
    method: "GET",
    path: "/v1/users/impersonation-targets",
    token,
  });
}

/** `DELETE /v1/users/me` — deletes the signed-in account (shared with HighScore). */
export function requestAccountDeletion(token: string): Promise<DeleteAccountResponse> {
  return apiRequest<DeleteAccountResponse>({ method: "DELETE", path: "/v1/users/me", token });
}
