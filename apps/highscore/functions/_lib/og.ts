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
  accent: string;
  emoji: string;
  title: string;
  subtitle: string;
  brandMark?: boolean;
}

const DEFAULT_IMAGE_VARIANT: ImageVariant = {
  accent: "#F5A524",
  emoji: HIGH_SCORE_OG_EMOJI,
  title: HIGH_SCORE_OG_TITLE,
  subtitle: HIGH_SCORE_OG_DESCRIPTION,
  brandMark: true,
};

const FRIEND_OG_EMOJI = "👋";
const FRIEND_OG_ACCENT = "#A78BFA";
const FRIEND_OG_FALLBACK_TITLE = "Add a friend on HighScore";

const GAME_SHARE_OG_EMOJI = "🎮";
const GAME_SHARE_OG_ACCENT = "#F5A524";
const GAME_SHARE_OG_FALLBACK_TITLE = "Play daily games on HighScore";

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

export function buildGameShareOgTitle(preview: GameSharePreview | null): string {
  const name = gameSharerName(preview);
  return name ? `Play games with ${name} on HighScore` : GAME_SHARE_OG_FALLBACK_TITLE;
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

function renderImageHtml(variant: ImageVariant, iconUrl: string): string {
  const emoji = escapeXml(variant.emoji);
  const title = escapeXml(truncate(variant.title, 28));
  const subtitle = escapeXml(variant.subtitle);
  const leading = variant.brandMark
    ? renderBrandIconHtml(iconUrl, 220)
    : `<div style="display: flex; width: 200px; height: 200px; border-radius: 44px; background: ${variant.accent}; align-items: center; justify-content: center; font-size: 132px; line-height: 1;">${emoji}</div>`;

  return `
<div style="display: flex; width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; background: #0E0C0B; color: #F2F0ED; font-family: 'Inter', sans-serif; padding: 80px; box-sizing: border-box;">
  <div style="display: flex; flex-direction: column; justify-content: center; gap: 24px; flex: 1;">
    ${leading}
    <div style="display: flex; font-size: 84px; font-weight: 700; letter-spacing: -2px; line-height: 1.05;">${title}</div>
    <div style="display: flex; font-size: 36px; font-weight: 500; color: #A7A29E; line-height: 1.2;">${subtitle}</div>
  </div>
</div>`.trim();
}

function renderBrandIconHtml(iconUrl: string, size: number): string {
  return `<img data-brand-icon="highscore" src="${escapeXml(iconUrl)}" width="${size}" height="${size}" style="width: ${size}px; height: ${size}px; object-fit: contain;" />`;
}

export function buildDefaultOgImageHtml(iconUrl: string): string {
  return renderImageHtml(DEFAULT_IMAGE_VARIANT, iconUrl);
}

export function buildFriendOgImageHtml(
  preview: FriendInvitePreview | null,
  iconUrl: string,
): string {
  const name = friendName(preview);
  return renderImageHtml(
    {
      accent: FRIEND_OG_ACCENT,
      emoji: FRIEND_OG_EMOJI,
      title: name ?? "Add a friend",
      subtitle: name
        ? "wants to be friends on HighScore"
        : "Compare your daily game scores on HighScore",
    },
    iconUrl,
  );
}

export function buildGameShareOgImageHtml(
  preview: GameSharePreview | null,
  iconUrl: string,
): string {
  const name = gameSharerName(preview);
  return renderImageHtml(
    {
      accent: GAME_SHARE_OG_ACCENT,
      emoji: GAME_SHARE_OG_EMOJI,
      title: name ?? "Play daily games",
      subtitle: name
        ? "Join me and play games on HighScore"
        : "Play daily games together on HighScore",
    },
    iconUrl,
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
