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

export type ShareVisibility = "off" | "view" | "join";

/**
 * Safe metadata subset returned by both `GET /v1/lists/by-slug/:slug/preview`
 * (new short-URL share surface) and `GET /v1/invites/:token/preview` (legacy
 * URLs already in iMessage / email). Anyone who has the slug or token already
 * has the full list surface via the join flow, so the fields here mirror
 * what they'd see after joining: title, branding, type, and rough shape.
 * We deliberately omit member identities and item contents.
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
  /** Echoes the list's current share visibility. */
  shareVisibility: ShareVisibility;
  /** Stable share slug — used by the `/list` middleware to point its OG image URL at the right renderer. */
  shareSlug: string;
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

/**
 * Per-list / per-invite preview meta tags. `pageUrl` is the share URL the
 * recipient lands on (echoed into `og:url` for card dedupe); `imageUrl`
 * points at the rasterized PNG that's co-located on the same origin.
 */
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

// --- Friend invite link previews (`/friends/accept/:token`) ---------------
// A friend invite has no list behind it — just the inviter's name — so it
// gets its own small card variant instead of the list-shaped one above.

export const FRIEND_OG_EMOJI = "👋";
export const FRIEND_OG_GRADIENT = COLOR_GRADIENTS.grape;
export const FRIEND_OG_FALLBACK_TITLE = "Add a friend on Workshop.dev";

/** Minimal preview returned by `GET /v1/friends/requests/:token`. */
export interface FriendInvitePreview {
  /** Inviter's display name, or null if they haven't set one. */
  inviterName: string | null;
}

function friendName(preview: FriendInvitePreview | null): string | null {
  const name = preview?.inviterName?.trim();
  return name && name.length > 0 ? name : null;
}

export function buildFriendOgTitle(preview: FriendInvitePreview | null): string {
  const name = friendName(preview);
  return name ? `${name} wants to be friends` : FRIEND_OG_FALLBACK_TITLE;
}

export function buildFriendOgDescription(preview: FriendInvitePreview | null): string {
  const name = friendName(preview);
  return name
    ? `${name} invited you to Workshop.dev. Accept to compare your daily game scores.`
    : "You've been invited to Workshop.dev. Accept to compare your daily game scores.";
}

/** Big title rendered inside the thumbnail image. */
export function buildFriendThumbnailTitle(preview: FriendInvitePreview | null): string {
  return friendName(preview) ?? "Add a friend";
}

/** Subtitle rendered inside the thumbnail image. */
export function buildFriendThumbnailSubtitle(preview: FriendInvitePreview | null): string {
  return friendName(preview)
    ? "wants to be friends on Workshop.dev"
    : "Compare your daily game scores on Workshop.dev";
}

/** Per-friend-invite preview meta tags (same belt-and-suspenders set). */
export function buildFriendMetaTags(
  preview: FriendInvitePreview | null,
  opts: { pageUrl: string; imageUrl: string },
): string {
  return buildMetaTagsRaw({
    title: buildFriendOgTitle(preview),
    description: buildFriendOgDescription(preview),
    url: opts.pageUrl,
    image: opts.imageUrl,
  });
}

/** The friend-invite thumbnail HTML passed to `workers-og`. */
export function buildFriendOgImageHtml(preview: FriendInvitePreview | null): string {
  return renderImageHtml({
    gradient: FRIEND_OG_GRADIENT,
    emoji: FRIEND_OG_EMOJI,
    title: buildFriendThumbnailTitle(preview),
    subtitle: buildFriendThumbnailSubtitle(preview),
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

export interface PagesEnv {
  EXPO_PUBLIC_API_URL?: string;
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

/**
 * Coerce a possibly-partial preview payload into a fully-populated
 * `InvitePreview` so downstream renderers (`buildSummaryLabel`,
 * `buildThumbnailSubtitle`, `buildOgImageHtml`) can rely on every field
 * being present. The PNG endpoint runs at the edge and reads the API
 * over the network; if the production API is rolled out before this
 * function (or the user pins an older API URL), missing `modules` /
 * `itemKind` would otherwise throw `undefined.includes(...)` and turn
 * the share link's thumbnail into a 500.
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
    // `shareVisibility` / `shareSlug` were added with the slug share-URL
    // redesign. Older API responses won't include them — fall back to safe
    // defaults so the renderer still produces a card.
    shareVisibility:
      p.shareVisibility === "off" || p.shareVisibility === "view" || p.shareVisibility === "join"
        ? p.shareVisibility
        : "join",
    shareSlug: typeof p.shareSlug === "string" ? p.shareSlug : "",
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
 * Fetch the inviter's name for a friend invite link. Hits the public
 * `GET /v1/friends/requests/:token` preview. Same null-on-failure contract as
 * the list fetchers — a flaky API or a flag-off games surface degrades to the
 * generic friend card, never a broken share link.
 */
export async function fetchFriendInvitePreview(
  token: string,
  env: PagesEnv,
): Promise<FriendInvitePreview | null> {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/v1/friends/requests/${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 60 } } as RequestInit,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { inviter?: { displayName?: unknown } };
    const displayName = body.inviter?.displayName;
    return { inviterName: typeof displayName === "string" ? displayName : null };
  } catch {
    return null;
  }
}

/**
 * Fetch the safe preview metadata for a list by ID. Mirrors `fetchInvitePreview`
 * but targets `/v1/lists/:id/preview`, which surfaces the same fields plus
 * `viewer.{authenticated,isMember}` (we ignore the viewer block here — link
 * crawlers are always anonymous). Returns the `ListPreview` payload cast
 * to `InvitePreview` since the fields match.
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
 * middleware can fall back to the generic variant (no leaking to URLs the
 * recipient didn't actually navigate to a real list with).
 */
export function extractListIdFromPath(pathname: string): string | null {
  const m = LIST_ID_PATH_RE.exec(pathname);
  return m?.[1] ? m[1].toLowerCase() : null;
}
