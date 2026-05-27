/**
 * Cloudflare Pages middleware: every request under `/list/...`.
 *
 * Replaces the domain-wide default Open Graph tags in `index.html` with a
 * list-specific variant so iMessage, Slack, Twitter, etc. show the list's
 * name, emoji, owner, and item count when someone shares a direct
 * `/list/:id/...` URL. Same shape as the `/l/:slug` and `/invite/:token`
 * previews; the recipient still has to sign in (and be a member or have
 * an invite) to actually open the list — the rich card just makes a
 * shared link look like a real preview instead of a generic lock icon.
 *
 * Two-mode card based on the list's `share_visibility`:
 *   - `view` / `join`  → rich list card. The shareable surface is open, so
 *                        revealing the same metadata the `/l/:slug` URL
 *                        already reveals isn't a regression.
 *   - `off`            → locked "Sign in to view this list" card. Owner
 *                        explicitly disabled share access, so even the
 *                        public crawler shouldn't leak list metadata.
 *
 * Falls back to the locked variant whenever the list ID can't be parsed,
 * the preview API fails, or the list has been deleted — `/list/...` URLs
 * should never advertise the brand-default card. Non-HTML responses pass
 * through untouched.
 */

import {
  buildLockedListMetaTags,
  buildMetaTags,
  escapeXml,
  extractListIdFromPath,
  fetchListPreview,
  LOCKED_LIST_OG_SUBTITLE,
  OG_META_SELECTORS,
  type PagesEnv,
} from "../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  next: () => Promise<Response>;
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return response;
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const listId = extractListIdFromPath(url.pathname);
  const preview = listId ? await fetchListPreview(listId, env) : null;
  // Honor the owner's visibility toggle: `off` falls back to the locked
  // card so the public crawler stops leaking the list's name/emoji.
  const useRich = preview !== null && preview.shareVisibility !== "off";

  const { meta, title } =
    useRich && preview
      ? {
          meta: buildMetaTags(preview, {
            pageUrl: request.url,
            imageUrl: `${origin}/og/list/${encodeURIComponent(listId as string)}.png`,
          }),
          title: `${preview.emoji} ${preview.name} · Workshop.dev`,
        }
      : {
          meta: buildLockedListMetaTags({ url: request.url, origin }),
          title: `Workshop.dev — ${LOCKED_LIST_OG_SUBTITLE}`,
        };

  // Strip the default OG tags inherited from index.html so the recipient's
  // crawler sees exactly one tag per property (Facebook's spec says first
  // wins; Twitter is inconsistent; Apple Link Presentation is closed-source
  // — single-tag is the only safe state).
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

  return rewriter.transform(response);
};
