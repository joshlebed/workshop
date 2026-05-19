/**
 * Cloudflare Pages Function: GET /og/:name.png
 *
 * Renders the static Open Graph thumbnails referenced by both
 * `apps/workshop/public/index.html` (the domain-wide default tags) and
 * `functions/list/_middleware.ts` (the locked-list variant served for
 * direct `/list/:id/...` URLs). The list of available names is owned by
 * `STATIC_IMAGE_VARIANTS` in `_lib/og.ts`; unknown names fall back to
 * the default so a stale meta tag can never produce a broken card.
 *
 * Same renderer as `og/invite/[token].ts` — kept in sync intentionally.
 */

import { ImageResponse, loadGoogleFont } from "workers-og";
import { buildStaticImageHtml, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "../_lib/og.js";

interface PagesContext {
  request: Request;
  params: { name?: string | string[] };
}

const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-—…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const raw = context.params.name;
  const captured = Array.isArray(raw) ? raw[0] : raw;
  if (!captured) {
    return new Response("not found", { status: 404 });
  }
  // The route file is `[name].ts`, so `/og/default.png` captures
  // `default.png`. Strip the extension so the variant lookup matches
  // bare keys. `.png` stays in the public URL because some scrapers
  // (Facebook in particular) sniff the URL extension as a hint and it
  // makes manual debugging less surprising.
  const name = captured.replace(/\.(png|webp|jpg|jpeg)$/i, "");

  const [bold, semibold] = await Promise.all([
    loadGoogleFont({ family: "Inter", weight: 700, text: TEXT_GLYPHS }),
    loadGoogleFont({ family: "Inter", weight: 600, text: TEXT_GLYPHS }),
  ]);

  return new ImageResponse(buildStaticImageHtml(name), {
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
      // Static thumbnails almost never change. 1h active + 1d SWR keeps
      // origin pressure low while still letting us iterate on copy
      // without re-deploying every recipient's cached card.
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};
