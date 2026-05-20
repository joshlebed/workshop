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

/**
 * Subset of `ItemKind` from `@workshop/shared/itemKinds` that can show up
 * on a list — kept inline so this module stays workspace-import-free for
 * the edge bundler (see header). Keep in sync with `ITEM_KIND_NAMES`.
 */
export type InvitePreviewItemKind = "movie" | "tv" | "book" | "link" | "spotify_album" | "plain";

/**
 * Safe metadata subset returned by `GET /v1/invites/:token/preview` for
 * unauthenticated link-preview crawlers. Anyone who has the token already
 * has the full list surface via `/accept`, so the fields here intentionally
 * mirror what they'd see after joining: title, branding, type, and rough
 * shape. We deliberately omit member identities and item contents.
 *
 * The label rendered into the OG card (`Movies`, `TV`, `Leaderboard`, …)
 * is derived from `itemKind` + `modules` in `buildSummaryLabel` —
 * the same derivation the home screen uses.
 */
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

/**
 * Long-form labels for the OG card. We deliberately diverge from the
 * home-screen `KIND_LABEL` ("Movies"/"TV"/"Books") here — an OG preview
 * needs more context because the recipient hasn't seen the list yet, and
 * "Movie list" / "Reading list" reads as a complete sentence head in
 * `Movie list by Alice · 12 items`.
 */
const KIND_FULL_LABEL: Partial<Record<InvitePreviewItemKind, string>> = {
  movie: "Movie list",
  tv: "TV list",
  book: "Reading list",
  spotify_album: "Album shelf",
};

/**
 * Pick a category label from `itemKind` + `modules`. Returns a non-empty
 * string so the OG subtitle never renders `undefined`.
 *
 * Priority order is deliberately different from the home screen: the
 * `link` itemKind is shared by many distinct list shapes (daily games,
 * date ideas, trips), so the module label is more descriptive than the
 * generic "Links". Anywhere the kind is unambiguous (movie, tv, book,
 * spotify_album) the kind label wins.
 */
export function buildSummaryLabel(opts: {
  itemKind: InvitePreviewItemKind | null;
  modules: readonly string[];
}): string {
  if (opts.modules.includes("leaderboard")) return "Leaderboard";
  if (opts.itemKind && KIND_FULL_LABEL[opts.itemKind]) {
    return KIND_FULL_LABEL[opts.itemKind] ?? "List";
  }
  if (opts.modules.includes("voting")) return "Poll";
  if (opts.modules.includes("todo")) return "Checklist";
  if (opts.itemKind === "link") return "Links";
  return "List";
}

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/**
 * Copy for the default thumbnail, used everywhere a more specific
 * preview isn't available (home, sign-in, settings, deep links to
 * surfaces the recipient must authenticate to view).
 */
export const DEFAULT_OG_TITLE = "Workshop.dev";
export const DEFAULT_OG_DESCRIPTION = "Shared lists for the things you love.";
export const DEFAULT_OG_EMOJI = "📋";

/**
 * Variant shown when an unauthenticated recipient opens a direct list
 * URL. Anyone with the URL still has to sign in to see the list itself,
 * so we keep the copy neutral and prompt the next step rather than
 * leaking the list's name or contents to the link preview crawler.
 */
export const LOCKED_LIST_OG_TITLE = "Workshop.dev";
export const LOCKED_LIST_OG_SUBTITLE = "Sign in to view this list";
export const LOCKED_LIST_OG_DESCRIPTION = "Sign in to Workshop.dev to view this shared list.";
export const LOCKED_LIST_OG_EMOJI = "🔒";

/**
 * Names of the meta tags injected by `buildMetaTagsRaw` / `buildMetaTags`,
 * exported so a Pages Function can build matching `meta[...]` selectors
 * for HTMLRewriter to strip in-place before re-emitting per-route
 * overrides. Keep this list in sync with the `buildMetaTagsRaw` output.
 */
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
  const typeLabel = buildSummaryLabel({ itemKind: preview.itemKind, modules: preview.modules });
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
  const typeLabel = buildSummaryLabel({ itemKind: preview.itemKind, modules: preview.modules });
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
export interface OgMetaValues {
  title: string;
  description: string;
  url: string;
  image: string;
}

/**
 * Low-level meta-tag builder. All higher-level variants — invite preview,
 * default fallback, locked list — pipe through this so the tag set stays
 * identical (Apple Link Presentation and Facebook both need the full
 * belt-and-suspenders surface to render reliably).
 */
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
  opts: { inviteUrl: string; imageUrl: string },
): string {
  return buildMetaTagsRaw({
    title: buildOgTitle(preview),
    description: buildOgDescription(preview),
    url: opts.inviteUrl,
    image: opts.imageUrl,
  });
}

/**
 * Default OG tag set for every URL on the domain that doesn't have a
 * more specific override. Rendered statically into `index.html` so the
 * home page, sign-in flow, and any future routes show good link previews
 * out of the box.
 */
export function buildDefaultMetaTags(opts: { origin: string }): string {
  return buildMetaTagsRaw({
    title: DEFAULT_OG_TITLE,
    description: DEFAULT_OG_DESCRIPTION,
    url: opts.origin,
    image: `${opts.origin}/og/default.png`,
  });
}

/**
 * Locked-list variant for `/list/:id/...` URLs the recipient must
 * authenticate to view. Doesn't leak the list's name or contents — the
 * preview just prompts the next step.
 */
export function buildLockedListMetaTags(opts: { url: string; origin: string }): string {
  return buildMetaTagsRaw({
    title: `${LOCKED_LIST_OG_TITLE} — ${LOCKED_LIST_OG_SUBTITLE}`,
    description: LOCKED_LIST_OG_DESCRIPTION,
    url: opts.url,
    image: `${opts.origin}/og/locked-list.png`,
  });
}

/**
 * HTML passed to `workers-og` (Satori) for the actual thumbnail. Uses
 * inline `style="…"` rather than `tw="…"` so we don't pay for the
 * Tailwind expansion at the edge. Layout: full-bleed gradient, large
 * emoji medallion on the left, title + subtitle on the right, wordmark
 * pinned to the bottom-left.
 */
export interface StaticImageVariant {
  emoji: string;
  title: string;
  subtitle: string;
  gradient: readonly [string, string];
}

/**
 * The two non-preview thumbnails the Pages Function exposes under
 * `/og/<name>.png`. `default` is the brand fallback for every URL on
 * the domain; `locked-list` is rendered for `/list/:id/...` URLs the
 * recipient still needs to authenticate to view.
 */
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
