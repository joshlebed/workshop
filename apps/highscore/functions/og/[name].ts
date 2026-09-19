import { ImageResponse } from "workers-og";
import { loadOgFonts, OG_CARD_CACHE_CONTROL } from "../_lib/fonts.js";
import {
  buildDefaultOgImageHtml,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ogAssetsFor,
  type PagesEnv,
} from "../_lib/og.js";

interface PagesContext {
  env: PagesEnv;
  params: { name?: string | string[] };
  request: Request;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const raw = context.params.name;
  const captured = Array.isArray(raw) ? raw[0] : raw;
  if (!captured) return new Response("not found", { status: 404 });

  const fonts = await loadOgFonts(context.env, context.request.url);
  const assets = ogAssetsFor(context.request.url);
  return new ImageResponse(buildDefaultOgImageHtml(assets), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: "png",
    fonts,
    headers: { "Cache-Control": OG_CARD_CACHE_CONTROL },
  });
};
