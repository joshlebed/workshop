/**
 * Cloudflare Pages Function: GET /friends/accept/:token
 *
 * Intercepts the friend-invite share URL before the static SPA is served so
 * iMessage, Slack, Twitter, etc. see Open Graph + Twitter Card tags naming the
 * person who's inviting you — instead of the generic Workshop.dev card. The
 * recipient's browser still receives the full SPA HTML (with the injected
 * tags) and expo-router takes over (`app/friends/accept/[token].tsx`) once it
 * hydrates.
 *
 * Friend links are a single-segment path (`:token`), so this is a discrete
 * function file rather than a `_middleware` like the `/list/...` route.
 *
 * Unlike the list-invite interceptor we never fall through to the unmodified
 * SPA on a missing preview: a friend link should always read as a friend
 * invite, so when the preview API is unreachable (or the games surface is
 * flag-off) we still emit the generic "Add a friend" friend card. We only
 * pass through if the static asset itself can't be fetched.
 */

import {
  buildFriendMetaTags,
  escapeXml,
  fetchFriendInvitePreview,
  OG_META_SELECTORS,
  type PagesEnv,
} from "../../_lib/og.js";

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

  // Null on any failure — the meta + image builders both degrade to the
  // generic friend card, so the share link still reads as a friend invite.
  const preview = await fetchFriendInvitePreview(token, env);

  const indexUrl = new URL("/index.html", request.url);
  const assetResponse = await env.ASSETS.fetch(indexUrl.toString());
  if (!assetResponse.ok) return next();

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const pageUrl = `${origin}/friends/accept/${encodeURIComponent(token)}`;
  // Co-locate the PNG on the page origin: Facebook's scraper rejects images
  // served from a redirect chain or a different origin than the page itself.
  const imageUrl = `${origin}/og/friend/${encodeURIComponent(token)}.png`;
  const meta = buildFriendMetaTags(preview, { pageUrl, imageUrl });

  const name = preview?.inviterName?.trim();
  const title = name ? `${name} on Workshop.dev` : "Add a friend · Workshop.dev";

  // Strip the default OG tags inherited from `index.html` first so the
  // crawler sees exactly one tag per property (Facebook's first-wins parser,
  // Twitter's inconsistency, Apple LinkPresentation's opacity).
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
