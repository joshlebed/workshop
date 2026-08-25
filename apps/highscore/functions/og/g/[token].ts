import { ImageResponse, loadGoogleFont } from "workers-og";
import {
  buildGameShareOgImageHtml,
  fetchGameSharePreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type PagesEnv,
} from "../../_lib/og.js";

interface PagesContext {
  env: PagesEnv;
  params: { token?: string | string[] };
}

const BASE_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;'\"-…·&/+()[]@#%*=";

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const captured = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!captured) return new Response("not found", { status: 404 });

  const token = captured.replace(/\.(png|webp|jpg|jpeg)$/i, "");
  const preview = await fetchGameSharePreview(token, context.env);
  const html = buildGameShareOgImageHtml(preview);
  const glyphs = `${BASE_GLYPHS}${preview?.sharerName ?? ""}`;
  const [bold, semibold] = await Promise.all([
    loadGoogleFont({ family: "Inter", weight: 700, text: glyphs }),
    loadGoogleFont({ family: "Inter", weight: 600, text: glyphs }),
  ]);

  return new ImageResponse(html, {
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
