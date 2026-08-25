import { API_URL } from "@workshop/api-client/config";

export function userAvatarImageUrl(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${API_URL}/v1/users/${encodeURIComponent(userId)}/avatar`;
}
