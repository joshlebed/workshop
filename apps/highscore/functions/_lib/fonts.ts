/**
 * Fonts for the Open Graph card renderer.
 *
 * Self-hosted from `public/fonts/` (Inter, SIL OFL — licence beside the
 * files) and fetched through the Pages ASSETS binding, so a render never
 * leaves the Cloudflare colo for Google Fonts. The decoded buffers are
 * memoised at module scope: a warm isolate pays 0ms for fonts.
 */

import type { PagesEnv } from "./og.js";

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 500 | 700;
  style: "normal";
}

const FONT_FILES: ReadonlyArray<{ weight: 500 | 700; path: string }> = [
  { weight: 700, path: "/fonts/Inter-700.ttf" },
  { weight: 500, path: "/fonts/Inter-500.ttf" },
];

const cache = new Map<string, Promise<ArrayBuffer>>();

function loadFont(env: PagesEnv, requestUrl: string, path: string): Promise<ArrayBuffer> {
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = env.ASSETS.fetch(new URL(path, requestUrl).toString()).then((response) => {
    if (!response.ok) throw new Error(`font asset ${path} returned ${response.status}`);
    return response.arrayBuffer();
  });
  // Don't memoise a failure — the next request should retry.
  pending.catch(() => cache.delete(path));
  cache.set(path, pending);
  return pending;
}

export async function loadOgFonts(env: PagesEnv, requestUrl: string): Promise<OgFont[]> {
  const buffers = await Promise.all(FONT_FILES.map((f) => loadFont(env, requestUrl, f.path)));
  return FONT_FILES.map((f, i) => ({
    name: "Inter",
    data: buffers[i] as ArrayBuffer,
    weight: f.weight,
    style: "normal",
  }));
}

/**
 * Per-token cards change only when the sharer renames themselves, so let the
 * edge hold them for a day and serve stale for a month while revalidating.
 * Platforms fetch a card once per link anyway; this makes the second platform
 * (and the sender's own device after the app pre-warms it) hit the cache.
 */
export const OG_CARD_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=2592000";
