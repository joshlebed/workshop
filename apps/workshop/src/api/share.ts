import { apiRequest } from "@workshop/api-client/api";
import type {
  AcceptInviteResponse,
  ListItemsResponse,
  ListPreviewResponse,
  ShareSettingsResponse,
  ShareVisibility,
  TransferOwnershipResponse,
  UpdateShareRequest,
} from "@workshop/shared";

/**
 * Public preview keyed by the short share slug. No bearer required — when
 * `token` is null the response's `viewer.authenticated` reflects that, and
 * the landing page renders the "Sign in to view" CTA.
 */
export function fetchListPreviewBySlug(
  slug: string,
  token: string | null,
): Promise<ListPreviewResponse> {
  return apiRequest<ListPreviewResponse>({
    method: "GET",
    path: `/v1/lists/by-slug/${encodeURIComponent(slug)}/preview`,
    token,
  });
}

/**
 * Items split for a slug-addressed list. Only callable when the slug's
 * visibility is `view` or when the bearer belongs to a member; the server
 * 404s otherwise so the slug itself stays opaque.
 */
export function fetchListItemsBySlug(
  slug: string,
  token: string | null,
): Promise<ListItemsResponse> {
  return apiRequest<ListItemsResponse>({
    method: "GET",
    path: `/v1/lists/by-slug/${encodeURIComponent(slug)}/items`,
    token,
  });
}

/** Joins the slug's list as a member. Requires auth. */
export function joinListBySlug(slug: string, token: string | null): Promise<AcceptInviteResponse> {
  return apiRequest<AcceptInviteResponse>({
    method: "POST",
    path: `/v1/lists/by-slug/${encodeURIComponent(slug)}/join`,
    token,
  });
}

/** Owner-only: update link visibility. */
export function updateListShare(
  listId: string,
  body: UpdateShareRequest,
  token: string | null,
): Promise<ShareSettingsResponse> {
  return apiRequest<ShareSettingsResponse>({
    method: "PATCH",
    path: `/v1/lists/${listId}/share`,
    body,
    token,
  });
}

/** Owner-only: rotate the share slug (kill the old link). */
export function resetListShareSlug(
  listId: string,
  token: string | null,
): Promise<ShareSettingsResponse> {
  return apiRequest<ShareSettingsResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/share/reset`,
    token,
  });
}

/** Owner-only: atomically transfer ownership to another member. */
export function transferOwnership(
  listId: string,
  newOwnerUserId: string,
  token: string | null,
): Promise<TransferOwnershipResponse> {
  return apiRequest<TransferOwnershipResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/members/${newOwnerUserId}/promote`,
    token,
  });
}

export const SHARE_VISIBILITY_LABELS: Record<ShareVisibility, { title: string; help: string }> = {
  off: {
    title: "Off",
    help: "The share link won't open the list for anyone outside this group.",
  },
  view: {
    title: "View with link",
    help: "Anyone with the link can read the list — they can't add items or change anything.",
  },
  join: {
    title: "Join with link",
    help: "Anyone with the link can join as a member and add items.",
  },
};
