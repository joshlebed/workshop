import type {
  AcceptInviteResponse,
  CreateInviteRequest,
  InviteResponse,
  MemberRemoveResponse,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function createInvite(
  listId: string,
  body: CreateInviteRequest | undefined,
  token: string | null,
): Promise<InviteResponse> {
  return apiRequest<InviteResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/invites`,
    body: body ?? {},
    token,
  });
}

export function revokeInvite(
  listId: string,
  inviteId: string,
  token: string | null,
): Promise<MemberRemoveResponse> {
  return apiRequest<MemberRemoveResponse>({
    method: "DELETE",
    path: `/v1/lists/${listId}/invites/${inviteId}`,
    token,
  });
}

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
