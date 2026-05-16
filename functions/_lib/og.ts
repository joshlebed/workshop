/**
 * Cloudflare-Pages-specific glue around `@workshop/shared/og`. The pure
 * metadata helpers live in the shared package so they can be unit-tested
 * with vitest; this file only contains the runtime bits that depend on
 * the Pages Functions environment (env bindings, network fetches).
 */

import type { InvitePreview } from "@workshop/shared/og";

export {
  buildMetaTags,
  buildOgImageHtml,
  escapeXml,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
} from "@workshop/shared/og";
export type { InvitePreview };

export interface PagesEnv {
  /** Base URL of the workshop API (e.g. `https://abc.execute-api.us-east-1.amazonaws.com`). */
  EXPO_PUBLIC_API_URL?: string;
  /** Cloudflare Pages auto-bound static-asset fetcher. */
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

/**
 * Fetch the safe preview metadata for an invite token. Returns `null` on
 * any non-2xx or network failure so the caller can gracefully fall back
 * to a static thumbnail — a failed preview should never break the share
 * link itself for the recipient.
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
