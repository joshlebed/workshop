// Challenge link (`/c/:token`): the HTML shell with this challenge's OG tags
// ("Beat Josh's 937" card) and App Links, one tag per property.
import {
  buildChallengeMetaTags,
  buildChallengeOgTitle,
  buildRouteAppLinkTags,
  fetchChallengePreview,
  type PagesEnv,
  ROUTE_META_SELECTORS,
} from "../_lib/og.js";

interface PagesContext {
  request: Request;
  env: PagesEnv;
  params: { token?: string | string[] };
  next: () => Promise<Response>;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) return context.next();

  const preview = await fetchChallengePreview(token, context.env);
  const assetResponse = await context.env.ASSETS.fetch(
    new URL("/index.html", context.request.url).toString(),
  );
  if (!assetResponse.ok) return context.next();

  const url = new URL(context.request.url);
  const origin = url.origin;
  const encodedToken = encodeURIComponent(token);
  const meta = buildChallengeMetaTags(preview, {
    pageUrl: `${origin}/c/${encodedToken}`,
    imageUrl: `${origin}/og/c/${encodedToken}.png`,
  });
  const appLinks = buildRouteAppLinkTags(context.request.url);
  const title = `${buildChallengeOgTitle(preview)} · HighScore`;

  const rewriter = new HTMLRewriter();
  // Strip every default OG / App Links / Smart Banner tag so each property
  // appears once, with this route's value.
  for (const selector of ROUTE_META_SELECTORS) {
    rewriter.on(selector, {
      element(element) {
        element.remove();
      },
    });
  }
  rewriter
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on("head", {
      element(element) {
        element.append(`${meta}\n    ${appLinks}`, { html: true });
      },
    });

  return rewriter.transform(assetResponse);
};
