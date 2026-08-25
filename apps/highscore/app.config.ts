// Dynamic Expo config overlay on top of `app.json`.
//
// We only need one thing from a dynamic config: surfacing the Niteshift
// preview origin to Expo CLI's `CorsMiddleware` so that POST/PATCH/DELETE
// requests from the iframe-hosted preview aren't rejected with a 401 HTML
// page. The middleware (`@expo/cli/.../middleware/CorsMiddleware.js`) reads
// `exp.extra.router.origin` and whitelists that host in addition to
// `localhost`. The Niteshift preview proxy forwards upstream with
// `Host: localhost:8081` but preserves the iframe `Origin:
// https://ns-8081-<task>.preview.niteshift.dev`, so without this whitelist
// the same-origin check fails and the dev sign-in (and any other write)
// POST gets bounced before our `dev-api-proxy.js` ever sees the request.
//
// Reads `NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL` — exported by the
// sandbox runtime in `/.env.setup` — or falls back to a manually-provided
// `EXPO_DEV_SERVER_ALLOWED_ORIGIN` for local reproductions of this script.
// Skipped silently when neither is set (a plain `pnpm dev` on a laptop
// already has `localhost` in the default allow-list).

import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const previewOrigin =
    process.env.NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL ??
    process.env.EXPO_DEV_SERVER_ALLOWED_ORIGIN ??
    null;

  if (!previewOrigin) {
    return config as ExpoConfig;
  }

  return {
    ...config,
    name: config.name ?? "HighScore",
    slug: config.slug ?? "highscore",
    extra: {
      ...config.extra,
      router: {
        ...(config.extra?.router ?? {}),
        // CorsMiddleware whitelists `new URL(origin).host`, so the value
        // needs to be the full URL (scheme + host).
        origin: previewOrigin,
      },
    },
  };
};
