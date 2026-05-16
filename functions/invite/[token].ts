/**
 * Cloudflare Pages Function: GET /invite/:token
 *
 * Intercepts the share URL before the static SPA is served so iMessage,
 * Slack, Twitter, etc. see Open Graph + Twitter Card tags for the
 * specific list being shared. The recipient's browser still receives the
 * full SPA HTML (with the injected tags) and expo-router takes over to
 * forward to `/onboarding/accept-invite?token=…` once it hydrates.
 *
 * If anything goes wrong (no API URL configured, preview 404, network
 * blip), we pass the request straight through to the static asset
 * pipeline — the share link must keep working even without a thumbnail.
 */

import { buildMetaTags, escapeXml, fetchInvitePreview, type PagesEnv } from "../_lib/og.js";

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

  const preview = await fetchInvitePreview(token, env);
  if (!preview) {
    // No metadata available — fall back to the unmodified SPA so the
    // share link still works for the recipient. The OG preview will be
    // empty, but that's strictly no worse than today's behaviour.
    return next();
  }

  const indexUrl = new URL("/index.html", request.url);
  const assetResponse = await env.ASSETS.fetch(indexUrl.toString());
  if (!assetResponse.ok) return next();

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;
  // Use the absolute, fully-qualified PNG URL. Facebook's scraper rejects
  // images served from a redirect chain or a different origin than the
  // page itself; co-locating them eliminates that whole failure mode.
  const imageUrl = `${origin}/og/invite/${encodeURIComponent(token)}.png`;
  const meta = buildMetaTags(preview, { inviteUrl, imageUrl });

  // HTMLRewriter streams the response and only mutates the bits we
  // touch, so the SPA's existing head (favicon, viewport, expo-router
  // bootstrap, etc.) is preserved verbatim.
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(escapeXml(`${preview.emoji} ${preview.name} · Workshop.dev`));
      },
    })
    .on("head", {
      element(el) {
        el.append(meta, { html: true });
      },
    })
    .transform(assetResponse);
};
