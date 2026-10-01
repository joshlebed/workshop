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

/**
 * Permanently delete the signed-in account. Self-only by construction — the
 * server derives the subject from the bearer token, there is no target id.
 * Rejects (never resolves) on any non-2xx, so the caller can't mistake an
 * offline failure for a deletion.
 */
export function requestAccountDeletion(token: string): Promise<DeleteAccountResponse> {
  return apiRequest<DeleteAccountResponse>({
    method: "DELETE",
    path: "/v1/users/me",
    token,
  });
}
