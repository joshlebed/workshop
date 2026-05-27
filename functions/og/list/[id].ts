/**
 * Cloudflare Pages Function: GET /og/list/:id.png
 *
 * Renders the Open Graph thumbnail referenced by `functions/list/
 * _middleware.ts` when a recipient shares a direct list URL. 1200×630 PNG
 * — same layout, gradient, and font subsetting story as the invite-token
 * variant; the only difference is the lookup goes through
 * `/v1/lists/:id/preview` rather than `/v1/invites/:token/preview`.
 *
 * Like the invite variant: recipients still need to sign in to actually
 * open the list, but the preview can show the list's name and emoji so
 * the link looks like a real share, not a generic locked card.
 */

import { ImageResponse, loadGoogleFont } from "workers-og";
import {
  buildOgImageHtml,
  fetchListPreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { id?: string | string[] };
}

const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-—…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const raw = context.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) {
    return new Response("not found", { status: 404 });
  }
  const normalizedId = id.replace(/\.(png|webp|jpg|jpeg)$/i, "");

  const preview = await fetchListPreview(normalizedId, context.env);

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
