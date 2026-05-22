# functions — Cloudflare Pages Functions

Open Graph + Twitter Card preview machinery for every URL on the production domain
(`workshop-a2v.pages.dev`). Three variants, layered:

1. **Default** — `apps/workshop/public/index.html` ships a static set of OG tags
   pointing at `/og/default.png`. Applied to every URL with no more specific override
   (home, sign-in, activity, settings, …). PNG generated on demand by
   `og/[name].ts`.
2. **Locked list** — `list/_middleware.ts` intercepts every `/list/...` URL, strips the
   defaults from the SPA `index.html`, and emits a "Sign in to view this list" variant
   pointing at `/og/locked-list.png`. Anyone with the URL still has to authenticate, so
   the card stays content-free on purpose (no name, emoji, item count).
3. **Public invite** — `invite/[token].ts` calls `GET /v1/invites/:token/preview` and
   emits a list-specific card with the real name, emoji, owner, item count, and color
   gradient. Image per-token, rendered by `og/invite/[token].ts`.

```
GET /invite/:token        → preview API → HTMLRewriter swaps defaults for per-list tags
GET /og/invite/:token.png → workers-og  → 1200×630 per-list PNG
GET /list/:id/...         → list/_middleware.ts → swaps defaults for locked-list variant
GET /og/:name.png         → workers-og  → 1200×630 static PNG (default, locked-list)
```

## Don't import from workspace packages

Cloudflare Pages's bundler runs at the repo root, but `functions/` isn't a pnpm
workspace member, so `node_modules/@workshop/` doesn't exist for esbuild to follow.
Keep function code self-contained: pure metadata helpers (`buildMetaTags`,
`buildOgImageHtml`, etc.) are inlined into `_lib/og.ts`. A mirror copy lives in
`packages/shared/src/og.ts` so vitest can unit-test the same surface; if you edit one,
update both in the same PR. Anything imported from `@workshop/shared/*` inside
`functions/**` silently fails the CF Pages build.

## One tag per property

Each route-specific Pages Function strips the default OG tags from `index.html` via
HTMLRewriter before appending its own. Facebook's spec says "first tag wins" for
duplicate `og:image` etc., Twitter is inconsistent, and Apple LinkPresentation is
closed-source — single-tag-per-property is the only safe state. If you add a new tag
to `buildMetaTagsRaw`, mirror its selector into `OG_META_SELECTORS` in the same PR or
the override pipeline leaves duplicates.

## OG image must be raster (PNG/JPEG)

Apple LinkPresentation and Facebook silently drop SVG `og:image` despite claiming to
accept it. Rasterizer is `workers-og` (Satori-based).

## AASA path allowlist

`functions/.well-known/apple-app-site-association.ts` serves the iOS Universal Links
allowlist as a Pages Function — not a static file in `public/`, because Cloudflare
serves extension-less files as `application/octet-stream` and iOS sometimes silently
rejects them. When you add a new shareable route that should open in the app, add the
`/path/*` entry to the function's `components` array. Apple's CDN-cached copy:
`curl https://app-site-association.cdn-apple.com/a/v1/workshop-a2v.pages.dev`.

## Verifying a thumbnail after deploy

Platforms cache aggressively (Facebook ~30 days per URL, iMessage per-conversation
forever). Verify against a **fresh invite** each time:

```bash
TOKEN=$(curl -sS -H "Authorization: Bearer $JWT" -X POST \
  https://<api>/v1/lists/<list-id>/invites -d '{}' \
  -H "Content-Type: application/json" | jq -r .invite.token)

node scripts/check-og.mjs "https://workshop-a2v.pages.dev/invite/$TOKEN"
```

`scripts/check-og.mjs` curls with a FB/Apple-LP-shaped UA, asserts OG tags, fetches the
image, and verifies PNG content-type + dimensions. Exits non-zero on mismatch. Expected
variant is inferred from the URL path (`/invite/...` → list-specific, `/list/...` →
locked-list copy, anything else → brand default).

Apple LinkPresentation has no debug API. Closest signal is `check-og.mjs` passing with
an Apple-shaped UA + a visual eyeball in `agent-browser`.

## Fast deploy loop (skip CI)

CF Pages auto-build is slow (~3–5min) AND silent on failure. Use wrangler directly
from the repo root:

```bash
pnpm deploy:pages:preview   # builds web + deploys to <branch>.workshop-a2v.pages.dev (~30s)
pnpm deploy:pages           # builds web + deploys to production
```

Both wrap `scripts/deploy-pages.sh` (handles Node 22 switch for wrangler). Auth via
`wrangler login` or `CLOUDFLARE_API_TOKEN`.

CI equivalent: `.github/workflows/deploy-pages.yml`, fires on push to `main` for
`apps/workshop/**`, `packages/shared/**`, `functions/**`. Asserts the production
`/og/invite/...png` endpoint serves PNG bytes before exiting green.

The deploy step calls `npx -y wrangler@latest pages deploy` directly rather than
`cloudflare/wrangler-action`. The action installs wrangler with `pnpm add wrangler@…`
inside the workspace root, which **pnpm 10 refuses without `-w`**
(`ERR_PNPM_ADDING_TO_ROOT`), so the action fails every run and prod silently stops
deploying. Stay with `npx`, or pass `-w` / `packageManager` overrides.
