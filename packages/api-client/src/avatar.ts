import { API_URL } from "./config";

/**
 * Image URL for a user's profile picture (`GET /v1/users/:id/avatar`).
 *
 * `version` is the server's `avatarVersion` for that user when the caller has
 * one (standings entries carry it): `null` means "no picture" and returns
 * null so the `Avatar` draws initials without a 404 round trip, and a string
 * is appended as a cache key so a changed picture gets a new URL. Omit it when
 * the surface has no version to hand (friends lists, profiles) — the bare URL
 * still works, it just can't tell a changed picture from the cached one.
 */
export function userAvatarImageUrl(
  userId: string | null | undefined,
  version?: string | null,
): string | null {
  if (!userId) return null;
  if (version === null) return null;
  const base = `${API_URL}/v1/users/${encodeURIComponent(userId)}/avatar`;
  return version === undefined ? base : `${base}?v=${encodeURIComponent(version)}`;
}
