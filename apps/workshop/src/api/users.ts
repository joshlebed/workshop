import { apiRequest } from "@workshop/api-client/api";
import type { ImpersonationTargetsResponse } from "@workshop/shared";

export function fetchImpersonationTargets(
  token: string | null,
): Promise<ImpersonationTargetsResponse> {
  return apiRequest<ImpersonationTargetsResponse>({
    method: "GET",
    path: "/v1/users/impersonation-targets",
    token,
  });
}
