import { apiRequest } from "@workshop/api-client/api";
import type { AcceptInviteResponse, ListPreview } from "@workshop/shared";

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

/**
 * Public preview for a legacy invite token (4.6): the same list card the
 * `/l/:slug` landing shows, so `/invite/:token` can ask before joining.
 */
export function fetchInvitePreview(inviteToken: string): Promise<{ preview: ListPreview }> {
  return apiRequest<{ preview: ListPreview }>({
    method: "GET",
    path: `/v1/invites/${encodeURIComponent(inviteToken)}/preview`,
  });
}
