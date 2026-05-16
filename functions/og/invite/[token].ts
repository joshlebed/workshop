/**
 * Cloudflare Pages Function: GET /og/invite/:token.png
 *
 * Renders the Open Graph thumbnail referenced by `functions/invite/
 * [token].ts`. 1200×630 PNG (Twitter/Facebook large-card aspect ratio,
 * which iMessage's LP framework also crops to nicely).
 *
 * We deliberately rasterize to PNG rather than serving SVG: the Apple
 * Link Presentation framework (iMessage on macOS + iOS) and Facebook's
 * scraper both silently drop SVG `og:image` responses in practice. The
 * earlier SVG implementation showed text + a blank white image card.
 *
 * Rendering goes through `workers-og` (satori → resvg-wasm) at the edge.
 * The font (Inter) is fetched from Google Fonts on first cold render and
 * cached by Cloudflare's HTTP cache thereafter; the PNG response itself
 * is also edge-cached with a 5-minute TTL.
 */

import { ImageResponse, loadGoogleFont } from "workers-og";
import {
  buildOgImageHtml,
  fetchInvitePreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { token?: string | string[] };
}

/**
 * Subset of glyphs we'll ever rasterize. Restricting `loadGoogleFont`
 * with a `text` param means we get a tiny subsetted .ttf instead of the
 * full 200KB Inter regular file — meaningful at edge cold start.
 */
const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-—…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) {
    return new Response("not found", { status: 404 });
  }
  // The route file is `[token].ts`, so a request for `/og/invite/abc.png`
  // captures `abc.png`. Strip the extension so the API lookup matches
  // the bare token. We keep `.png` in the public URL because some
  // scrapers (Facebook in particular) sniff URL extension as a hint and
  // it makes manual debugging less surprising.
  const normalizedToken = token.replace(/\.(png|webp|jpg|jpeg)$/i, "");

  const preview = await fetchInvitePreview(normalizedToken, context.env);

  const [bold, semibold] = await Promise.all([
    loadGoogleFont({ family: "Inter", weight: 700, text: TEXT_GLYPHS }),
    loadGoogleFont({ family: "Inter", weight: 600, text: TEXT_GLYPHS }),
  ]);

  return new ImageResponse(buildOgImageHtml(preview), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: "png",
    fonts: [
      { name: "Inter", data: bold, weight: 700, style: "normal" },
      { name: "Inter", data: semibold, weight: 600, style: "normal" },
      { name: "Inter", data: semibold, weight: 500, style: "normal" },
    ],
    // Render emoji via Twemoji raster glyphs. Without this the renderer
    // would fall back to drawing emoji as missing-glyph boxes since the
    // Inter subset doesn't include them.
    emoji: "twemoji",
    // CF Pages auto-caches GETs with these headers at the edge. 5min
    // active + 1h SWR balances "owner just renamed the list" against
    // "iMessage cached this for the conversation already".
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
};
