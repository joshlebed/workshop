/**
 * Shared helpers for the Cloudflare Pages Functions that render link-preview
 * HTML and OG images for share URLs. These functions intercept requests like
 * `/invite/:token` so iMessage/Slack/Twitter scrapers see proper Open Graph
 * tags + a per-list thumbnail without the recipient needing to be signed in
 * to the SPA.
 *
 * Real browsers receive the SPA `index.html` with the meta tags injected
 * into `<head>`; expo-router still handles client-side routing and forwards
 * to `/onboarding/accept-invite` once it hydrates.
 */

export interface InvitePreview {
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  type: ListType;
  itemCount: number;
  memberCount: number;
  ownerName: string | null;
}

export type ListColor = "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";
export type ListType = "movie" | "tv" | "book" | "date_idea" | "trip" | "album_shelf" | "game";

export interface PagesEnv {
  /** Base URL of the workshop API (e.g. `https://abc.execute-api.us-east-1.amazonaws.com`). */
  EXPO_PUBLIC_API_URL?: string;
  /** Cloudflare Pages auto-bound static-asset fetcher. */
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

/**
 * Fetch the safe preview metadata for an invite token. Returns `null` on
 * any non-2xx or network failure so the caller can gracefully fall back to
 * the bare SPA — a failed preview should never block the share URL from
 * loading in the recipient's browser.
 */
export async function fetchInvitePreview(
  token: string,
  env: PagesEnv,
): Promise<InvitePreview | null> {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/v1/invites/${encodeURIComponent(token)}/preview`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 60 } } as RequestInit,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { preview?: InvitePreview };
    return body.preview ?? null;
  } catch {
    return null;
  }
}

/**
 * Hex gradient stops keyed by list color. Mirrors the `tokens.list[key]`
 * map in `apps/workshop/src/ui/theme.ts` so the OG thumbnail uses the same
 * palette the recipient will see inside the app. Two stops per color so we
 * can render a top-left → bottom-right gradient that doesn't read flat.
 */
export const COLOR_GRADIENTS: Record<ListColor, [string, string]> = {
  sunset: ["#FF8A65", "#E84C61"],
  ocean: ["#5EC5E6", "#2A6FB0"],
  forest: ["#7CB87C", "#2F7A4B"],
  grape: ["#B58AE0", "#6A3FA8"],
  rose: ["#F4A6C0", "#C94878"],
  sand: ["#E6CFA1", "#B08858"],
  slate: ["#9AA8B5", "#475568"],
};

/** Human label per list type for the secondary line of the thumbnail. */
export const TYPE_LABELS: Record<ListType, string> = {
  movie: "Movie list",
  tv: "TV list",
  book: "Reading list",
  date_idea: "Date ideas",
  trip: "Travel plans",
  album_shelf: "Album shelf",
  game: "Game leaderboard",
};

/** Escape minimal HTML/SVG-unsafe characters in user-provided strings. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Truncate to N visible characters with an ellipsis. Operates on
 * code-point boundaries so a multi-byte emoji or accented character
 * doesn't get sliced in half.
 */
export function truncate(input: string, max: number): string {
  const chars = Array.from(input);
  if (chars.length <= max) return input;
  return `${chars.slice(0, max - 1).join("")}…`;
}
