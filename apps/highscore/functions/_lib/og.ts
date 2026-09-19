/**
 * Cloudflare Pages helpers for HighScore Open Graph previews.
 *
 * SELF-CONTAINED ON PURPOSE. Pages Functions are bundled outside the pnpm
 * workspace package graph, so importing from @workshop/* can make a Cloudflare
 * build fail even when the monorepo typecheck passes. Keep this file free of
 * workspace imports.
 */

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export const HIGH_SCORE_OG_TITLE = "HighScore";
export const HIGH_SCORE_OG_DESCRIPTION = "Compete in daily games";
export const HIGH_SCORE_OG_EMOJI = "🎮";

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

/** Same-origin static assets the card renderer draws. */
export function ogAssetsFor(requestUrl: string): OgAssets {
  return {
    iconUrl: new URL("/icon-source.png", requestUrl).toString(),
    backgroundUrl: new URL("/og-bg.png", requestUrl).toString(),
  };
}

export interface OgAssets {
  /** `/icon-source.png` — the app icon artwork. */
  iconUrl: string;
  /** `/og-bg.png` — pre-rendered background (scripts/build-og-background.mjs). */
  backgroundUrl: string;
}

export interface PagesEnv {
  EXPO_PUBLIC_API_URL?: string;
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

export interface FriendInvitePreview {
  inviterName: string | null;
}

export interface GameSharePreview {
  sharerName: string | null;
}

export interface OgMetaValues {
  title: string;
  description: string;
  url: string;
  image: string;
}

interface ImageVariant {
  title: string;
  /** Second text line. Omit for a single-line card. */
  subtitle?: string;
  /** Character cap before an ellipsis. */
  titleMax?: number;
}

const DEFAULT_IMAGE_VARIANT: ImageVariant = {
  title: HIGH_SCORE_OG_TITLE,
  subtitle: HIGH_SCORE_OG_DESCRIPTION,
};

const FRIEND_OG_FALLBACK_TITLE = "Add a friend on HighScore";

/** The link title shown under the thumbnail. Kept name-free on purpose. */
const GAME_SHARE_OG_TITLE = "Play daily games on HighScore";
/** Longest first name the single-line card will render before an ellipsis. */
const GAME_SHARE_NAME_MAX = 20;

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

export function buildMetaTagsRaw(values: OgMetaValues): string {
  const safeTitle = escapeXml(values.title);
  const safeDescription = escapeXml(values.description);
  const safeUrl = escapeXml(values.url);
  const safeImage = escapeXml(values.image);

  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${HIGH_SCORE_OG_TITLE}" />`,
    `<meta property="og:url" content="${safeUrl}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDescription}" />`,
    `<meta property="og:image" content="${safeImage}" />`,
    `<meta property="og:image:secure_url" content="${safeImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${safeTitle}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDescription}" />`,
    `<meta name="twitter:image" content="${safeImage}" />`,
    `<meta name="description" content="${safeDescription}" />`,
  ].join("\n    ");
}

export function buildDefaultMetaTags(origin: string): string {
  return buildMetaTagsRaw({
    title: HIGH_SCORE_OG_TITLE,
    description: HIGH_SCORE_OG_DESCRIPTION,
    url: origin,
    image: `${origin}/og/default.png`,
  });
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
    ? `${name} invited you to HighScore. Accept to compare your daily game scores.`
    : "You've been invited to HighScore. Accept to compare your daily game scores.";
}

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

export function buildGameShareOgTitle(_preview: GameSharePreview | null): string {
  return GAME_SHARE_OG_TITLE;
}

export function buildGameShareOgDescription(preview: GameSharePreview | null): string {
  const name = gameSharerName(preview);
  return name
    ? `${name} is playing daily games on HighScore. Join to compare your scores.`
    : "Join HighScore to play daily games and compare scores with friends.";
}

export function buildGameShareMetaTags(
  preview: GameSharePreview | null,
  opts: { pageUrl: string; imageUrl: string },
): string {
  return buildMetaTagsRaw({
    title: buildGameShareOgTitle(preview),
    description: buildGameShareOgDescription(preview),
    url: opts.pageUrl,
    image: opts.imageUrl,
  });
}

function gameSharerName(preview: GameSharePreview | null): string | null {
  const name = preview?.sharerName?.trim();
  return name && name.length > 0 ? name : null;
}

/** First whitespace-delimited word of the sharer's display name. */
function gameSharerFirstName(preview: GameSharePreview | null): string | null {
  const name = gameSharerName(preview);
  if (!name) return null;
  const [first] = name.split(/\s+/);
  return first && first.length > 0 ? truncate(first, GAME_SHARE_NAME_MAX) : null;
}

/** The single text line rendered inside the play-link thumbnail. */
export function buildGameShareThumbnailTitle(preview: GameSharePreview | null): string {
  const first = gameSharerFirstName(preview);
  return first ? `Play games with ${first}` : GAME_SHARE_OG_TITLE;
}

const CARD_PADDING = 80;
const CONTENT_WIDTH = OG_IMAGE_WIDTH - CARD_PADDING * 2;
const ICON_SIZE = 300;
const ICON_TEXT_GAP = 56;
// Inter Bold averages ~0.56em per glyph at letter-spacing -0.02em; size the
// title so one line spans the content width, within [64, 112]px.
const TITLE_EM_PER_CHAR = 0.56;
const TITLE_MIN_PX = 64;
const TITLE_MAX_PX = 112;

function fitTitleSize(text: string): number {
  const chars = Math.max(1, Array.from(text).length);
  const fit = CONTENT_WIDTH / (chars * TITLE_EM_PER_CHAR);
  return Math.round(Math.min(TITLE_MAX_PX, Math.max(TITLE_MIN_PX, fit)));
}

function renderImageHtml(variant: ImageVariant, assets: OgAssets): string {
  const title = escapeXml(truncate(variant.title, variant.titleMax ?? 28));
  // A two-line card has to leave room for the subtitle under a 300px icon.
  const titleSize = Math.min(fitTitleSize(title), variant.subtitle === undefined ? Infinity : 92);
  const subtitle =
    variant.subtitle === undefined
      ? ""
      : `\n    <div style="display: flex; flex-shrink: 0; margin-top: 14px; font-size: 40px; font-weight: 500; color: #C9C4BF; line-height: 1.2;">${escapeXml(variant.subtitle)}</div>`;

  // The background is a pre-rendered raster (OKLab-blended, dithered) rather
  // than CSS gradients: Satori/resvg interpolate gradients in sRGB with no
  // dither, which bands and greys out on a dark card.
  return `
<div style="display: flex; position: relative; width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; background: #0F0D14; color: #F5F2EE; font-family: 'Inter', sans-serif; overflow: hidden;">
  <img data-og-background src="${escapeXml(assets.backgroundUrl)}" width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" style="position: absolute; top: 0; left: 0; width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px;" />
  <div style="display: flex; flex-direction: column; justify-content: center; position: absolute; top: 0; left: 0; width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; padding: ${CARD_PADDING}px; box-sizing: border-box;">
    ${renderBrandIconHtml(assets.iconUrl, ICON_SIZE)}
    <div style="display: flex; flex-shrink: 0; margin-top: ${ICON_TEXT_GAP}px; font-size: ${titleSize}px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05;">${title}</div>${subtitle}
  </div>
</div>`.trim();
}

function renderBrandIconHtml(iconUrl: string, size: number): string {
  return `<img data-brand-icon="highscore" src="${escapeXml(iconUrl)}" width="${size}" height="${size}" style="width: ${size}px; height: ${size}px; flex-shrink: 0; object-fit: contain;" />`;
}

export function buildDefaultOgImageHtml(assets: OgAssets): string {
  return renderImageHtml(DEFAULT_IMAGE_VARIANT, assets);
}

export function buildFriendOgImageHtml(
  preview: FriendInvitePreview | null,
  assets: OgAssets,
): string {
  const name = friendName(preview);
  return renderImageHtml(
    {
      title: name ? `${truncate(name, 20)} wants to be friends` : "Add a friend on HighScore",
      titleMax: 48,
    },
    assets,
  );
}

export function buildGameShareOgImageHtml(
  preview: GameSharePreview | null,
  assets: OgAssets,
): string {
  // App icon + one line ("Play games with <first name>"). No subtitle.
  return renderImageHtml(
    {
      title: buildGameShareThumbnailTitle(preview),
      titleMax: 64,
    },
    assets,
  );
}

export async function fetchFriendInvitePreview(
  token: string,
  env: PagesEnv,
): Promise<FriendInvitePreview | null> {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/v1/friends/requests/${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 60 } } as RequestInit,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { inviter?: { displayName?: unknown } };
    const displayName = body.inviter?.displayName;
    return { inviterName: typeof displayName === "string" ? displayName : null };
  } catch {
    return null;
  }
}

export async function fetchGameSharePreview(
  token: string,
  env: PagesEnv,
): Promise<GameSharePreview | null> {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/v1/game-share/${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 60 } } as RequestInit,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { displayName?: unknown } };
    const displayName = body.user?.displayName;
    return { sharerName: typeof displayName === "string" ? displayName : null };
  } catch {
    return null;
  }
}
