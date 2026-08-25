import { ImageResponse, loadGoogleFont } from "workers-og";
import { buildDefaultOgImageHtml, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "../_lib/og.js";

interface PagesContext {
  params: { name?: string | string[] };
}

const TEXT_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const raw = context.params.name;
  const captured = Array.isArray(raw) ? raw[0] : raw;
  if (!captured) return new Response("not found", { status: 404 });

  const [bold, semibold] = await Promise.all([
    loadGoogleFont({ family: "Inter", weight: 700, text: TEXT_GLYPHS }),
    loadGoogleFont({ family: "Inter", weight: 600, text: TEXT_GLYPHS }),
  ]);

  return new ImageResponse(buildDefaultOgImageHtml(), {
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
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};
