/**
 * Cloudflare Pages helpers for Open Graph link previews.
 *
 * SELF-CONTAINED ON PURPOSE. The functions/ directory is not a pnpm
 * workspace member, so when Cloudflare Pages's edge bundler (esbuild via
 * Wrangler) tries to resolve `@workshop/shared/og` it fails — there's no
 * `node_modules/@workshop/` at the repo root for it to follow. PR #168
 * and #169 both deploy-failed with exactly this error before this file
 * was inlined. Keep this module free of workspace imports.
 *
 * The pure helpers below are mirrored from `packages/shared/src/og.ts`,
 * which still owns the unit-test coverage (`packages/shared/src/og.test.ts`).
 * Treat the shared file as the canonical readable source; this file is
 * the bundled-at-the-edge copy. The surface is small (pure string
 * functions, no logic divergence between callers) so drift is low-risk,
 * but if you edit one, update the other in the same PR.
 */

export type ListColor = "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";

export type ListType = "movie" | "tv" | "book" | "date_idea" | "trip" | "album_shelf" | "game";

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

export const COLOR_GRADIENTS: Record<ListColor, readonly [string, string]> = {
  sunset: ["#FF8A65", "#E84C61"],
  ocean: ["#5EC5E6", "#2A6FB0"],
  forest: ["#7CB87C", "#2F7A4B"],
  grape: ["#B58AE0", "#6A3FA8"],
  rose: ["#F4A6C0", "#C94878"],
  sand: ["#E6CFA1", "#B08858"],
  slate: ["#9AA8B5", "#475568"],
};

export const FALLBACK_GRADIENT = COLOR_GRADIENTS.slate;

export const TYPE_LABELS: Record<ListType, string> = {
  movie: "Movie list",
  tv: "TV list",
  book: "Reading list",
  date_idea: "Date ideas",
  trip: "Travel plans",
  album_shelf: "Album shelf",
  game: "Game leaderboard",
};

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(input: string, max: number): string {
  const chars = Array.from(input);
  if (chars.length <= max) return input;
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function buildOgTitle(preview: InvitePreview): string {
  return `${preview.emoji} ${preview.name}`;
}

export function buildOgDescription(preview: InvitePreview): string {
  if (preview.description && preview.description.trim().length > 0) {
    return truncate(preview.description.trim(), 200);
  }
  const typeLabel = TYPE_LABELS[preview.type];
  const owner = preview.ownerName ? ` by ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return `${typeLabel}${owner} · ${items}. Join on Workshop.dev.`;
}

export function buildThumbnailSubtitle(preview: InvitePreview): string {
  const typeLabel = TYPE_LABELS[preview.type];
  const owner = preview.ownerName ? ` · ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return truncate(`${typeLabel} · ${items}${owner}`, 60);
}

export function buildMetaTags(
  preview: InvitePreview,
  opts: { inviteUrl: string; imageUrl: string },
): string {
  const title = buildOgTitle(preview);
  const description = buildOgDescription(preview);
  const safeTitle = escapeXml(title);
  const safeDesc = escapeXml(description);
  const safeUrl = escapeXml(opts.inviteUrl);
  const safeImage = escapeXml(opts.imageUrl);

  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Workshop.dev" />`,
    `<meta property="og:url" content="${safeUrl}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:image" content="${safeImage}" />`,
    `<meta property="og:image:secure_url" content="${safeImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${safeTitle}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    `<meta name="twitter:image" content="${safeImage}" />`,
    `<meta name="description" content="${safeDesc}" />`,
  ].join("\n    ");
}

export function buildOgImageHtml(preview: InvitePreview | null): string {
  const [start, end] = preview ? COLOR_GRADIENTS[preview.color] : FALLBACK_GRADIENT;
  const emoji = preview ? escapeXml(preview.emoji) : "📋";
  const title = preview ? escapeXml(truncate(preview.name, 28)) : "Workshop.dev";
  const subtitle = preview
    ? escapeXml(buildThumbnailSubtitle(preview))
    : "Shared lists for the things you love";

  return `
<div style="display: flex; width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; background: linear-gradient(135deg, ${start} 0%, ${end} 100%); color: white; font-family: 'Inter', sans-serif; padding: 80px; box-sizing: border-box; position: relative;">
  <div style="display: flex; flex-direction: column; justify-content: center; gap: 24px; flex: 1;">
    <div style="display: flex; align-items: center; gap: 32px;">
      <div style="display: flex; width: 200px; height: 200px; border-radius: 44px; background: rgba(255, 255, 255, 0.22); align-items: center; justify-content: center; font-size: 132px; line-height: 1;">${emoji}</div>
    </div>
    <div style="display: flex; font-size: 84px; font-weight: 700; letter-spacing: -2px; line-height: 1.05;">${title}</div>
    <div style="display: flex; font-size: 36px; font-weight: 500; opacity: 0.92; line-height: 1.2;">${subtitle}</div>
  </div>
  <div style="display: flex; position: absolute; bottom: 60px; left: 80px; align-items: center; gap: 16px; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">
    <div style="display: flex; width: 28px; height: 28px; border-radius: 14px; background: white;"></div>
    <span>Workshop.dev</span>
  </div>
</div>`.trim();
}

export interface PagesEnv {
  EXPO_PUBLIC_API_URL?: string;
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
