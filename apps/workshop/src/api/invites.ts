import type { AcceptInviteResponse } from "@workshop/shared";
import { apiRequest } from "../lib/api";

/**
 * Legacy invite-token acceptance. Kept around so URLs already in iMessage /
 * email threads continue to work — new sharing happens via the per-list
 * `share_slug` (see `api/share.ts`). The Pages Function for `/invite/:token`
 * also redirects to the canonical `/l/:slug` URL once the user has joined.
 */
export function acceptInvite(
  inviteToken: string,
  token: string | null,
): Promise<AcceptInviteResponse> {
  return apiRequest<AcceptInviteResponse>({
    method: "POST",
    path: `/v1/invites/${encodeURIComponent(inviteToken)}/accept`,
    token,
  });
}
