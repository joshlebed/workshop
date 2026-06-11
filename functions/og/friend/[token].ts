/**
 * Cloudflare Pages Function: GET /og/friend/:token.png
 *
 * Renders the Open Graph thumbnail referenced by
 * `functions/friends/accept/[token].ts`. 1200×630 PNG (Twitter/Facebook
 * large-card aspect ratio, which iMessage's LP framework crops nicely).
 *
 * Same `workers-og` (satori → resvg-wasm) pipeline + Inter font subset as the
 * list-invite renderer. A null preview (API unreachable / games flag off /
 * bad token) renders the generic "Add a friend" card rather than 500-ing.
 */

import { ImageResponse, loadGoogleFont } from "workers-og";
import {
  buildFriendOgImageHtml,
  fetchFriendInvitePreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { token?: string | string[] };
}

const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-—…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) {
    return new Response("not found", { status: 404 });
  }
  // The route file is `[token].ts`, so `/og/friend/abc.png` captures
  // `abc.png`. Strip the extension so the API lookup matches the bare token;
  // `.png` stays in the public URL because some scrapers (Facebook) sniff the
  // extension as a content-type hint.
  const normalizedToken = token.replace(/\.(png|webp|jpg|jpeg)$/i, "");

  const preview = await fetchFriendInvitePreview(normalizedToken, context.env);

  const [bold, semibold] = await Promise.all([
    loadGoogleFont({ family: "Inter", weight: 700, text: TEXT_GLYPHS }),
    loadGoogleFont({ family: "Inter", weight: 600, text: TEXT_GLYPHS }),
  ]);

  return new ImageResponse(buildFriendOgImageHtml(preview), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: "png",
    fonts: [
      { name: "Inter", data: bold, weight: 700, style: "normal" },
      { name: "Inter", data: semibold, weight: 600, style: "normal" },
      { name: "Inter", data: semibold, weight: 500, style: "normal" },
    ],
    // Render the 👋 via Twemoji raster glyphs — the Inter subset has no emoji.
    emoji: "twemoji",
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
};
