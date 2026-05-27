/**
 * Cloudflare Pages Function: GET /l/:slug
 *
 * The canonical short share URL. Same Open Graph machinery as the legacy
 * `/invite/:token` route, just keyed by the per-list `share_slug` instead
 * of a one-time invite token. Recipient's browser receives the SPA HTML
 * with per-list OG / Twitter Card tags injected via HTMLRewriter; the SPA
 * route at `app/l/[slug].tsx` takes over once the page hydrates.
 *
 * If the preview API fails (slug rotated, list archived, network blip),
 * we pass through to the static asset pipeline so the share URL still
 * resolves to a working SPA page — just without a list-specific thumbnail.
 */

import {
  buildMetaTags,
  escapeXml,
  fetchListPreviewBySlug,
  OG_META_SELECTORS,
  type PagesEnv,
} from "../_lib/og.js";

/**
 * The slug-keyed PNG renderer lives at `og/l/[slug].ts`. The legacy
 * `/list/:id/...` middleware uses the id-keyed renderer at
 * `og/list/[id].ts` (PR #245) — both produce the same rich card.
 */

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { slug?: string | string[] };
  next: () => Promise<Response>;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const { request, env, params, next } = context;
  const slugRaw = params.slug;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;
  if (!slug) return next();

  const preview = await fetchListPreviewBySlug(slug, env);
  if (!preview) return next();

  const indexUrl = new URL("/index.html", request.url);
  const assetResponse = await env.ASSETS.fetch(indexUrl.toString());
  if (!assetResponse.ok) return next();

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const shareUrl = `${origin}/l/${encodeURIComponent(slug)}`;
  // Image co-located with the page origin: Facebook's scraper rejects
  // cross-origin or redirected `og:image` URLs in practice, even when the
  // spec says it shouldn't matter.
  const imageUrl = `${origin}/og/l/${encodeURIComponent(slug)}.png`;
  const meta = buildMetaTags(preview, { pageUrl: shareUrl, imageUrl });

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
        el.setInnerContent(escapeXml(`${preview.emoji} ${preview.name} · Workshop.dev`));
      },
    })
    .on("head", {
      element(el) {
        el.append(meta, { html: true });
      },
    });
  return rewriter.transform(assetResponse);
};
