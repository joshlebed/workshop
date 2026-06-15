/**
 * Cloudflare Pages Function: GET /.well-known/apple-app-site-association
 *
 * Apple App Site Association (AASA) file for iOS Universal Links. When
 * the Workshop.dev app declares `applinks:workshop-a2v.pages.dev` in its
 * entitlements (`apps/workshop/app.json` -> `ios.associatedDomains`), iOS
 * fetches this file at install time (via Apple's CDN) and again on a
 * configurable interval. Any path in `components` opens the installed
 * app instead of Safari.
 *
 * Why a Pages Function instead of a static file in `public/`:
 *   1. Apple requires `Content-Type: application/json` (or absent) with
 *      no redirects. Cloudflare Pages serves extension-less files as
 *      `application/octet-stream`, which iOS sometimes accepts and
 *      sometimes silently rejects. Pinning the content type here removes
 *      that whole failure mode.
 *   2. The App ID lives in one place (`eas.json` -> `appleTeamId` +
 *      `app.json` -> `bundleIdentifier`); evolving the path allowlist or
 *      adding a second bundle id is a code change with review, not a
 *      hand-edited JSON blob.
 *
 * Verify after deploy with:
 *   curl -sS https://workshop-a2v.pages.dev/.well-known/apple-app-site-association \
 *     | jq .
 *   curl -sI https://workshop-a2v.pages.dev/.well-known/apple-app-site-association \
 *     | grep -i content-type   # must be application/json
 *
 * Apple's own validator: https://app-site-association.cdn-apple.com/a/v1/workshop-a2v.pages.dev
 */

const APP_ID = "Q65U6C65ZZ.dev.josh.workshop";

const AASA = {
  applinks: {
    details: [
      {
        appIDs: [APP_ID],
        components: [
          // Short share URL — `/l/:slug`, the primary share surface.
          { "/": "/l/*" },
          // Legacy public-invite share links — kept working for old URLs.
          { "/": "/invite/*" },
          // Direct list / item / game URLs — open in app for installed users.
          { "/": "/list/*" },
          // Friend invite links — open the accept screen in app, not Safari.
          { "/": "/friends/accept/*" },
          // Play links (Games copy-scores CTA) — open the resolver in app.
          { "/": "/g/*" },
        ],
      },
    ],
  },
} as const;

export const onRequestGet = (): Response => {
  return new Response(JSON.stringify(AASA), {
    headers: {
      "content-type": "application/json",
      // Apple's CDN respects cache-control; one hour is enough headroom to
      // ship a path-list change without forcing every device to refetch.
      "cache-control": "public, max-age=3600",
    },
  });
};
