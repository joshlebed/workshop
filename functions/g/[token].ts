/**
 * Cloudflare Pages Function: GET /g/:token
 *
 * Intercepts the play-link share URL (the Games-tab copy-scores CTA, minted by
 * `POST /v1/game-share`) before the static SPA is served, so iMessage, Slack,
 * Twitter, etc. see Open Graph + Twitter Card tags inviting the recipient to
 * "play games with <name>" — instead of the generic Workshop.dev card (or, as
 * before this route existed, a misleading friend-invite card). The recipient's
 * browser still receives the full SPA HTML (with the injected tags) and
 * expo-router takes over (`app/g/[token].tsx`) once it hydrates, where it routes
 * already-friends → Games home and everyone else → the sharer's profile.
 *
 * Like the friend interceptor — and unlike the list routes — we never fall
 * through to the unmodified SPA on a missing preview: a play link should always
 * read as one, so a null preview (API down / games flag off / bad token) still
 * emits the generic "Play daily games" card. We only pass through if the static
 * asset itself can't be fetched.
 */

import {
  buildGameShareMetaTags,
  escapeXml,
  fetchGameSharePreview,
  OG_META_SELECTORS,
  type PagesEnv,
} from "../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { token?: string | string[] };
  next: () => Promise<Response>;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const { request, env, params, next } = context;
  const tokenRaw = params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) return next();

  // Null on any failure — the meta + image builders both degrade to the generic
  // play card, so the share link still reads as an invitation to play.
  const preview = await fetchGameSharePreview(token, env);

  const indexUrl = new URL("/index.html", request.url);
  const assetResponse = await env.ASSETS.fetch(indexUrl.toString());
  if (!assetResponse.ok) return next();

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const pageUrl = `${origin}/g/${encodeURIComponent(token)}`;
  // Co-locate the PNG on the page origin: Facebook's scraper rejects images
  // served from a redirect chain or a different origin than the page itself.
  const imageUrl = `${origin}/og/g/${encodeURIComponent(token)}.png`;
  const meta = buildGameShareMetaTags(preview, { pageUrl, imageUrl });

  const name = preview?.sharerName?.trim();
  const title = name ? `Play games with ${name} · Workshop.dev` : "Play games · Workshop.dev";

  // Strip the default OG tags inherited from `index.html` first so the crawler
  // sees exactly one tag per property (Facebook's first-wins parser, Twitter's
  // inconsistency, Apple LinkPresentation's opacity).
  const rewriter = new HTMLRewriter();
  for (const selector of OG_META_SELECTORS) {
    rewriter.on(selector, {
      element(el) {
        el.remove();
      },
    });
  }
  rewriter
    .on("title", {
      element(el) {
        el.setInnerContent(escapeXml(title));
      },
    })
    .on("head", {
      element(el) {
        el.append(meta, { html: true });
      },
    });
  return rewriter.transform(assetResponse);
};
