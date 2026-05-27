/**
 * Cloudflare Pages Function: GET /og/l/:slug.png
 *
 * Renders the Open Graph thumbnail for the slug-addressed share URL. Same
 * `workers-og` (satori → resvg-wasm) pipeline as the legacy invite-token
 * renderer; 1200×630 PNG, 5-minute edge cache, Inter from Google Fonts.
 *
 * The route file is `[slug].ts`, so a request for `/og/l/abc12345.png`
 * captures `abc12345.png`. We strip the extension before calling the
 * preview API — the `.png` stays in the public URL because some scrapers
 * (Facebook in particular) sniff extension as a content-type hint.
 */

import { ImageResponse, loadGoogleFont } from "workers-og";
import {
  buildOgImageHtml,
  fetchListPreviewBySlug,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { slug?: string | string[] };
}

const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-—…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const slugRaw = context.params.slug;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;
  if (!slug) {
    return new Response("not found", { status: 404 });
  }
  const normalizedSlug = slug.replace(/\.(png|webp|jpg|jpeg)$/i, "");

  const preview = await fetchListPreviewBySlug(normalizedSlug, context.env);

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
    emoji: "twemoji",
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
};
