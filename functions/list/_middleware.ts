/**
 * Cloudflare Pages middleware: every request under `/list/...`.
 *
 * Replaces the domain-wide default Open Graph tags in `index.html`
 * with a "Sign in to view this list" variant so iMessage, Slack,
 * Twitter, etc. show a list-shaped card when someone shares a direct
 * list / item / game URL. The recipient still needs to authenticate
 * to view the list itself; the card just signals what they'll see
 * once they sign in.
 *
 * We deliberately don't include the list's name, emoji, or item count
 * here — anyone with the URL still has to authenticate to view that
 * data, so leaking it via the public preview crawler would be a
 * regression. Public invite tokens (`/invite/:token`) remain the only
 * path that shows per-list details to unauthenticated crawlers.
 *
 * Passes non-HTML responses (static assets the SPA might serve from
 * `/list/...` someday) straight through untouched.
 */

import {
  buildLockedListMetaTags,
  escapeXml,
  LOCKED_LIST_OG_SUBTITLE,
  OG_META_SELECTORS,
} from "../_lib/og.js";

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return response;
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const meta = buildLockedListMetaTags({ url: request.url, origin });

  // Strip the default OG tags inherited from index.html so the
  // recipient's crawler sees exactly one tag per property (Facebook's
  // spec says first wins; Twitter is inconsistent; Apple Link
  // Presentation is closed-source — single-tag is the only safe state).
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
        el.setInnerContent(escapeXml(`Workshop.dev — ${LOCKED_LIST_OG_SUBTITLE}`));
      },
    })
    .on("head", {
      element(el) {
        el.append(meta, { html: true });
      },
    });

  return rewriter.transform(response);
};
