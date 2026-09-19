import { ImageResponse } from "workers-og";
import { loadOgFonts, OG_CARD_CACHE_CONTROL } from "../../_lib/fonts.js";
import {
  buildFriendOgImageHtml,
  fetchFriendInvitePreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ogAssetsFor,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  env: PagesEnv;
  params: { token?: string | string[] };
  request: Request;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const captured = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!captured) return new Response("not found", { status: 404 });

  const token = captured.replace(/\.(png|webp|jpg|jpeg)$/i, "");
  const [preview, fonts] = await Promise.all([
    fetchFriendInvitePreview(token, context.env),
    loadOgFonts(context.env, context.request.url),
  ]);
  const html = buildFriendOgImageHtml(preview, ogAssetsFor(context.request.url));

  return new ImageResponse(html, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: "png",
    fonts,
    headers: { "Cache-Control": OG_CARD_CACHE_CONTROL },
  });
};
