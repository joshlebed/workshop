import type { ImpersonationTargetsResponse } from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchImpersonationTargets(
  token: string | null,
): Promise<ImpersonationTargetsResponse> {
  return apiRequest<ImpersonationTargetsResponse>({
    method: "GET",
    path: "/v1/users/impersonation-targets",
    token,
  });
}
