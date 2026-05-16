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

import {
  escapeXml,
  fetchInvitePreview,
  type InvitePreview,
  type PagesEnv,
  TYPE_LABELS,
  truncate,
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
  const imageUrl = `${origin}/og/invite/${encodeURIComponent(token)}`;
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

function buildMetaTags(
  preview: InvitePreview,
  opts: { inviteUrl: string; imageUrl: string },
): string {
  const title = `${preview.emoji} ${preview.name}`;
  const description = buildDescription(preview);
  const safeTitle = escapeXml(title);
  const safeDesc = escapeXml(description);
  const safeUrl = escapeXml(opts.inviteUrl);
  const safeImage = escapeXml(opts.imageUrl);

  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Workshop.dev" />`,
    `<meta property="og:url" content="${safeUrl}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:image" content="${safeImage}" />`,
    `<meta property="og:image:type" content="image/svg+xml" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${safeTitle}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    `<meta name="twitter:image" content="${safeImage}" />`,
    `<meta name="description" content="${safeDesc}" />`,
  ].join("\n    ");
}

function buildDescription(preview: InvitePreview): string {
  if (preview.description && preview.description.trim().length > 0) {
    return truncate(preview.description.trim(), 200);
  }
  const typeLabel = TYPE_LABELS[preview.type];
  const owner = preview.ownerName ? ` by ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return `${typeLabel}${owner} · ${items}. Join on Workshop.dev.`;
}
