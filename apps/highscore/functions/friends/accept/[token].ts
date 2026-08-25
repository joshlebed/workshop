import {
  buildFriendMetaTags,
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
  const tokenRaw = context.params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (!token) return context.next();

  const preview = await fetchFriendInvitePreview(token, context.env);
  const assetResponse = await context.env.ASSETS.fetch(
    new URL("/index.html", context.request.url).toString(),
  );
  if (!assetResponse.ok) return context.next();

  const url = new URL(context.request.url);
  const origin = url.origin;
  const encodedToken = encodeURIComponent(token);
  const meta = buildFriendMetaTags(preview, {
    pageUrl: `${origin}/friends/accept/${encodedToken}`,
    imageUrl: `${origin}/og/friend/${encodedToken}.png`,
  });
  const name = preview?.inviterName?.trim();
  const title = name ? `${name} on HighScore` : "Add a friend · HighScore";

  const rewriter = new HTMLRewriter();
  for (const selector of OG_META_SELECTORS) {
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
        element.append(meta, { html: true });
      },
    });

  return rewriter.transform(assetResponse);
};
