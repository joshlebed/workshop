import type { MemberRemoveResponse } from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function removeMember(
  listId: string,
  userId: string,
  token: string | null,
): Promise<MemberRemoveResponse> {
  return apiRequest<MemberRemoveResponse>({
    method: "DELETE",
    path: `/v1/lists/${listId}/members/${userId}`,
    token,
  });
}
