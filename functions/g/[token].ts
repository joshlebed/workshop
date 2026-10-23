/**
 * Cloudflare Pages Function: GET /g/:token
 *
 * Play links (`/g/:token`, the Games copy-scores CTA) are minted on
 * highscore.live since daily games moved to HighScore. Links already pasted
 * into iMessage / Slack still point here, so this route permanently redirects
 * to the HighScore equivalent — same token, same path — instead of rendering a
 * Workshop-branded card for a surface Workshop no longer owns. Crawlers follow
 * the 301 and pick up HighScore's OG tags; browsers land on HighScore's
 * resolver. Never 404.
 *
 * An installed Workshop app intercepts this URL first (the AASA claims
 * `/g/*`); its in-app resolver performs the same hand-off.
 */

const HIGHSCORE_ORIGIN = "https://highscore.live";

interface PagesContext {
  request: Request;
  params: { token?: string | string[] };
  next: () => Promise<Response>;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const { params, next } = context;
  const tokenRaw = params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) return next();
  return Response.redirect(`${HIGHSCORE_ORIGIN}/g/${encodeURIComponent(token)}`, 301);
};
