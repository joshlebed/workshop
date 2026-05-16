/**
 * Cloudflare Pages Function: GET /og/invite/:token
 *
 * Renders the Open Graph thumbnail referenced by `functions/invite/
 * [token].ts`. 1200×630 (Twitter/Facebook large-card aspect ratio, which
 * iMessage's LP framework also crops to nicely). Pure SVG so the
 * function has zero external deps; iOS Image I/O renders SVG fine, and
 * the file is small enough (<2KB) to inline-cache aggressively.
 *
 * Layout: full-bleed gradient using the list's color token, a giant
 * emoji glyph on the left, the list name + type label on the right,
 * with a "Workshop.dev" wordmark in the corner.
 */

import {
  COLOR_GRADIENTS,
  escapeXml,
  fetchInvitePreview,
  type PagesEnv,
  TYPE_LABELS,
  truncate,
} from "../../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { token?: string | string[] };
}

const FALLBACK_GRADIENT = COLOR_GRADIENTS.slate;

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) {
    return new Response("not found", { status: 404 });
  }

  const preview = await fetchInvitePreview(token, context.env);
  const svg = renderSvg(preview);

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Per-token thumbnail content can change (rename, emoji swap) but
      // not often. 5 minutes at the edge + 1 hour stale-while-revalidate
      // keeps social bots fast on re-fetch while still picking up edits
      // within a few minutes.
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
};

function renderSvg(preview: Awaited<ReturnType<typeof fetchInvitePreview>>): string {
  const [start, end] = preview ? COLOR_GRADIENTS[preview.color] : FALLBACK_GRADIENT;
  const emoji = preview ? escapeXml(preview.emoji) : "📋";
  const title = preview ? escapeXml(truncate(preview.name, 36)) : "Workshop.dev";
  const sub = preview ? escapeXml(buildSubtitle(preview)) : "Shared lists for the things you love";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${start}" />
      <stop offset="100%" stop-color="${end}" />
    </linearGradient>
    <filter id="soften" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />

  <!-- Decorative blurred orbs for depth -->
  <circle cx="980" cy="120" r="180" fill="#ffffff" fill-opacity="0.10" filter="url(#soften)" />
  <circle cx="150" cy="540" r="140" fill="#000000" fill-opacity="0.08" filter="url(#soften)" />

  <!-- Emoji medallion -->
  <g transform="translate(120, 220)">
    <rect x="-20" y="-20" width="260" height="260" rx="48" fill="#ffffff" fill-opacity="0.18" />
    <text
      x="110"
      y="180"
      font-size="180"
      text-anchor="middle"
      font-family="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
    >${emoji}</text>
  </g>

  <!-- Title block -->
  <g transform="translate(420, 270)" fill="#ffffff" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
    <text x="0" y="0" font-size="76" font-weight="700" letter-spacing="-2">${title}</text>
    <text x="0" y="68" font-size="34" font-weight="500" opacity="0.85">${sub}</text>
  </g>

  <!-- Wordmark -->
  <g transform="translate(72, 540)" fill="#ffffff" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
    <circle cx="14" cy="14" r="10" fill="#ffffff" />
    <text x="40" y="22" font-size="28" font-weight="600" letter-spacing="-0.5">Workshop.dev</text>
  </g>
</svg>`;
}

function buildSubtitle(
  preview: NonNullable<Awaited<ReturnType<typeof fetchInvitePreview>>>,
): string {
  const typeLabel = TYPE_LABELS[preview.type];
  const owner = preview.ownerName ? ` · ${preview.ownerName}` : "";
  const items = preview.itemCount === 1 ? "1 item" : `${preview.itemCount} items`;
  return truncate(`${typeLabel} · ${items}${owner}`, 60);
}
