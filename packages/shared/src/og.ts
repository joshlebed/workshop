/**
 * Pure helpers for rendering Open Graph link-preview metadata for share
 * URLs. Lives in `@workshop/shared` so the Cloudflare Pages Functions
 * (`functions/invite/[token].ts`, `functions/og/invite/[token].ts`) and
 * the corresponding unit tests can share one source of truth.
 *
 * Self-contained on purpose: no internal `./types.js` imports, no
 * runtime dependencies. Imported through the `"./og"` subpath in the
 * package `exports` map for the same reason `./constants` exists — keep
 * runtime imports off the type barrel (see CLAUDE.md).
 */

export type ListColor = "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";

export type ListType = "movie" | "tv" | "book" | "date_idea" | "trip" | "album_shelf" | "game";

/**
 * Safe metadata subset returned by `GET /v1/invites/:token/preview` for
 * unauthenticated link-preview crawlers. Anyone who has the token already
 * has the full list surface via `/accept`, so the fields here intentionally
 * mirror what they'd see after joining: title, branding, type, and rough
 * shape. We deliberately omit member identities and item contents.
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

/**
 * Hex stops keyed by list color, mirroring `tokens.list[key]` in
 * `apps/workshop/src/ui/theme.ts` so the OG thumbnail matches what the
 * recipient sees inside the app. Two stops per color so a top-left →
 * bottom-right gradient doesn't read flat.
 */
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

/**
 * Subtitle rendered inside the thumbnail image itself. Shorter than the
 * `og:description` because the visual layout has less room and we don't
 * want it wrapping to three lines.
 */
export function buildThumbnailSubtitle(preview: InvitePreview): string {
  const typeLabel = TYPE_LABELS[preview.type];
  const owner = preview.ownerName ? ` · ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return truncate(`${typeLabel} · ${items}${owner}`, 60);
}

/**
 * Build the `<meta>` tag block injected into the SPA `<head>` for
 * link-preview crawlers. Returned as a single string so a Pages Function
 * can `el.append(...)` it via `HTMLRewriter`.
 *
 * Includes the full belt-and-suspenders set for Open Graph + Twitter
 * Cards: explicit `og:image:secure_url`, `og:image:type` (so Facebook
 * doesn't need to fetch-to-sniff), dimensions, and an alt. Apple Link
 * Presentation respects the same tags as Facebook in practice.
 */
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

/**
 * HTML passed to `workers-og` (Satori) for the actual thumbnail. Uses
 * inline `style="…"` rather than `tw="…"` so we don't pay for the
 * Tailwind expansion at the edge. Layout: full-bleed gradient, large
 * emoji medallion on the left, title + subtitle on the right, wordmark
 * pinned to the bottom-left.
 */
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
