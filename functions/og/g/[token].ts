/**
 * Cloudflare Pages Function: GET /og/g/:token.png
 *
 * Companion to `/g/:token`: the play-card PNG now lives on highscore.live.
 * Permanent redirect so any crawler that cached the old image URL re-fetches
 * the HighScore-branded card.
 */

const HIGHSCORE_ORIGIN = "https://highscore.live";

interface PagesContext {
  params: { token?: string | string[] };
  next: () => Promise<Response>;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) return context.next();
  const clean = token.endsWith(".png") ? token.slice(0, -".png".length) : token;
  return Response.redirect(`${HIGHSCORE_ORIGIN}/og/g/${encodeURIComponent(clean)}.png`, 301);
};
