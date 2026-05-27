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

export type InvitePreviewItemKind = "movie" | "tv" | "book" | "link" | "spotify_album" | "plain";

export interface InvitePreview {
  name: string;
  emoji: string;
  color: ListColor;
  description: string | null;
  itemKind: InvitePreviewItemKind | null;
  modules: readonly string[];
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

const KIND_FULL_LABEL: Partial<Record<InvitePreviewItemKind, string>> = {
  movie: "Movie list",
  tv: "TV list",
  book: "Reading list",
  spotify_album: "Album shelf",
};

export function buildSummaryLabel(opts: {
  itemKind: InvitePreviewItemKind | null;
  modules: readonly string[];
}): string {
  if (opts.modules.includes("leaderboard")) return "Leaderboard";
  if (opts.itemKind && KIND_FULL_LABEL[opts.itemKind]) {
    return KIND_FULL_LABEL[opts.itemKind] ?? "List";
  }
  if (opts.modules.includes("todo")) return "Checklist";
  if (opts.itemKind === "link") return "Links";
  return "List";
}

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export const DEFAULT_OG_TITLE = "Workshop.dev";
export const DEFAULT_OG_DESCRIPTION = "Shared lists for the things you love.";
export const DEFAULT_OG_EMOJI = "📋";

export const LOCKED_LIST_OG_TITLE = "Workshop.dev";
export const LOCKED_LIST_OG_SUBTITLE = "Sign in to view this list";
export const LOCKED_LIST_OG_DESCRIPTION = "Sign in to Workshop.dev to view this shared list.";
export const LOCKED_LIST_OG_EMOJI = "🔒";

export const OG_META_SELECTORS = [
  'meta[property="og:type"]',
  'meta[property="og:site_name"]',
  'meta[property="og:url"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:image"]',
  'meta[property="og:image:secure_url"]',
  'meta[property="og:image:type"]',
  'meta[property="og:image:width"]',
  'meta[property="og:image:height"]',
  'meta[property="og:image:alt"]',
  'meta[name="twitter:card"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'meta[name="twitter:image"]',
  'meta[name="description"]',
] as const;

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
  const typeLabel = buildSummaryLabel({ itemKind: preview.itemKind, modules: preview.modules });
  const owner = preview.ownerName ? ` by ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return `${typeLabel}${owner} · ${items}. Join on Workshop.dev.`;
}

export function buildThumbnailSubtitle(preview: InvitePreview): string {
  const typeLabel = buildSummaryLabel({ itemKind: preview.itemKind, modules: preview.modules });
  const owner = preview.ownerName ? ` · ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return truncate(`${typeLabel} · ${items}${owner}`, 60);
}

export interface OgMetaValues {
  title: string;
  description: string;
  url: string;
  image: string;
}

export function buildMetaTagsRaw(values: OgMetaValues): string {
  const safeTitle = escapeXml(values.title);
  const safeDesc = escapeXml(values.description);
  const safeUrl = escapeXml(values.url);
  const safeImage = escapeXml(values.image);

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

export function buildMetaTags(
  preview: InvitePreview,
  opts: { pageUrl: string; imageUrl: string },
): string {
  return buildMetaTagsRaw({
    title: buildOgTitle(preview),
    description: buildOgDescription(preview),
    url: opts.pageUrl,
    image: opts.imageUrl,
  });
}

export function buildDefaultMetaTags(opts: { origin: string }): string {
  return buildMetaTagsRaw({
    title: DEFAULT_OG_TITLE,
    description: DEFAULT_OG_DESCRIPTION,
    url: opts.origin,
    image: `${opts.origin}/og/default.png`,
  });
}

export function buildLockedListMetaTags(opts: { url: string; origin: string }): string {
  return buildMetaTagsRaw({
    title: `${LOCKED_LIST_OG_TITLE} — ${LOCKED_LIST_OG_SUBTITLE}`,
    description: LOCKED_LIST_OG_DESCRIPTION,
    url: opts.url,
    image: `${opts.origin}/og/locked-list.png`,
  });
}

export interface StaticImageVariant {
  emoji: string;
  title: string;
  subtitle: string;
  gradient: readonly [string, string];
}

export const STATIC_IMAGE_VARIANTS = {
  default: {
    emoji: DEFAULT_OG_EMOJI,
    title: DEFAULT_OG_TITLE,
    subtitle: DEFAULT_OG_DESCRIPTION,
    gradient: COLOR_GRADIENTS.ocean,
  },
  "locked-list": {
    emoji: LOCKED_LIST_OG_EMOJI,
    title: LOCKED_LIST_OG_TITLE,
    subtitle: LOCKED_LIST_OG_SUBTITLE,
    gradient: COLOR_GRADIENTS.grape,
  },
} as const satisfies Record<string, StaticImageVariant>;

export type StaticImageVariantName = keyof typeof STATIC_IMAGE_VARIANTS;

function renderImageHtml(opts: {
  gradient: readonly [string, string];
  emoji: string;
  title: string;
  subtitle: string;
}): string {
  const [start, end] = opts.gradient;
  const emoji = escapeXml(opts.emoji);
  const title = escapeXml(truncate(opts.title, 28));
  const subtitle = escapeXml(opts.subtitle);

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

export function buildOgImageHtml(preview: InvitePreview | null): string {
  if (!preview) {
    return renderImageHtml(STATIC_IMAGE_VARIANTS.default);
  }
  return renderImageHtml({
    gradient: COLOR_GRADIENTS[preview.color] ?? FALLBACK_GRADIENT,
    emoji: preview.emoji,
    title: preview.name,
    subtitle: buildThumbnailSubtitle(preview),
  });
}

export function buildStaticImageHtml(name: string): string {
  const variant =
    name in STATIC_IMAGE_VARIANTS
      ? STATIC_IMAGE_VARIANTS[name as StaticImageVariantName]
      : STATIC_IMAGE_VARIANTS.default;
  return renderImageHtml(variant);
}

export interface PagesEnv {
  EXPO_PUBLIC_API_URL?: string;
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

/**
 * Coerce a possibly-partial preview payload into a fully-populated
 * `InvitePreview` so downstream renderers can rely on every field being
 * present. The PNG endpoint runs at the edge and reads the API over the
 * network; if production rolls out a newer renderer before the API
 * (or pins to an older API URL), missing `modules` / `itemKind` would
 * otherwise throw `undefined.includes(...)` and turn the thumbnail into
 * a 500.
 */
function normalizePreview(raw: unknown): InvitePreview | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<InvitePreview> & Record<string, unknown>;
  if (typeof p.name !== "string" || typeof p.emoji !== "string") return null;
  return {
    name: p.name,
    emoji: p.emoji,
    color: (p.color as ListColor) ?? "slate",
    description: typeof p.description === "string" ? p.description : null,
    itemKind: (p.itemKind as InvitePreviewItemKind | null) ?? null,
    modules: Array.isArray(p.modules) ? (p.modules as readonly string[]) : [],
    itemCount: typeof p.itemCount === "number" ? p.itemCount : 0,
    memberCount: typeof p.memberCount === "number" ? p.memberCount : 0,
    ownerName: typeof p.ownerName === "string" ? p.ownerName : null,
  };
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
    const body = (await res.json()) as { preview?: unknown };
    return normalizePreview(body.preview);
  } catch {
    return null;
  }
}

/**
 * Fetch the safe preview metadata for a list by ID. Mirrors `fetchInvitePreview`
 * but targets `/v1/lists/:id/preview`, which surfaces the same fields plus
 * a `viewer` block we ignore here (link crawlers are always anonymous).
 *
 * Powers the per-list OG thumbnail under `/list/:id/...` URLs — recipients
 * still have to sign in to actually open the list, but the preview can
 * show the list's name, emoji, and shape instead of a generic lock icon.
 */
export async function fetchListPreview(
  listId: string,
  env: PagesEnv,
): Promise<InvitePreview | null> {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/v1/lists/${encodeURIComponent(listId)}/preview`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 60 } } as RequestInit,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { preview?: unknown };
    return normalizePreview(body.preview);
  } catch {
    return null;
  }
}

const LIST_ID_PATH_RE =
  /^\/list\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/**
 * Pull the list UUID out of a `/list/:id/...` pathname. Returns `null` for
 * any URL that doesn't start with a UUID segment so the locked-list
 * middleware can fall back to the generic variant.
 */
export function extractListIdFromPath(pathname: string): string | null {
  const m = LIST_ID_PATH_RE.exec(pathname);
  return m?.[1] ? m[1].toLowerCase() : null;
}
