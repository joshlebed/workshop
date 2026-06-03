# functions — Cloudflare Pages Functions

Open Graph + Twitter Card preview machinery for every URL on the production domain
(`workshop-a2v.pages.dev`). Four routes, layered around the `share_slug` / `share_visibility`
model owned by the backend `lists` table:

1. **Default** — `apps/workshop/public/index.html` ships a static set of OG tags
   pointing at `/og/default.png`. Applied to every URL with no more specific override
   (home, sign-in, activity, settings, …). PNG generated on demand by `og/[name].ts`.
2. **Short share URL** — `l/[slug].ts` is the primary share surface. Calls
   `GET /v1/lists/by-slug/:slug/preview` and emits a list-specific card (name, emoji,
   owner, item count, color gradient). Image rendered by `og/l/[slug].ts`.
3. **Canonical list URL** — `list/_middleware.ts` intercepts every `/list/...` URL,
   calls `GET /v1/lists/:id/preview`, and picks rich-vs-locked based on
   `shareVisibility`: `view` / `join` → rich list card pointing at the id-keyed
   `og/list/:id.png` renderer; `off` (or preview failed) → "Sign in to view this list"
   variant pointing at `/og/locked-list.png`. The two cards stay single-tag-per-property
   via `OG_META_SELECTORS`.
4. **Legacy invite** — `invite/[token].ts` is kept around so old share URLs in
   iMessage / email keep working. Calls `GET /v1/invites/:token/preview` and emits the
   same list-specific card (via `og/invite/[token].ts`). We don't mint new invite
   tokens; this is a back-compat surface only.

```
GET /l/:slug              → preview API → HTMLRewriter swaps defaults for per-list tags
GET /og/l/:slug.png       → workers-og  → 1200×630 per-list PNG
GET /list/:id/...         → list/_middleware.ts → rich card when shareVisibility ∈ {view, join}, locked otherwise
GET /og/list/:id.png      → workers-og  → 1200×630 per-list PNG (id-keyed)
GET /invite/:token        → legacy preview API → per-list tags (back-compat)
GET /og/invite/:token.png → legacy PNG renderer (back-compat)
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
forever). Verify against a **freshly rotated slug** each time — owners reset via
`POST /v1/lists/:id/share/reset`:

```bash
SLUG=$(curl -sS -H "Authorization: Bearer $JWT" -X POST \
  https://<api>/v1/lists/<list-id>/share/reset | jq -r .shareSlug)

node scripts/check-og.mjs "https://workshop-a2v.pages.dev/l/$SLUG"
```

`scripts/check-og.mjs` curls with a FB/Apple-LP-shaped UA, asserts OG tags, fetches the
image, and verifies PNG content-type + dimensions. Exits non-zero on mismatch. Expected
variant is inferred from the URL path (`/l/...` and `/invite/...` → list-specific,
`/list/...` → list-specific when shareVisibility allows, locked copy otherwise, anything
else → brand default).

Apple LinkPresentation has no debug API. Closest signal is `check-og.mjs` passing with
an Apple-shaped UA + a visual eyeball in `agent-browser`.

## How web ships, and the fast deploy loop

Production web is deployed by **Cloudflare Pages' native Git integration** on every push to
`main`; the build result posts back to the commit as the "Cloudflare Pages" check, so
failures are visible (not silent). **No GitHub Actions workflow deploys web.** CF auto-build
is slow (~3–5min) — for a fast manual deploy, run wrangler directly from the repo root:

```bash
pnpm deploy:pages:preview   # builds web + deploys to <branch>.workshop-a2v.pages.dev (~30s)
pnpm deploy:pages           # builds web + deploys to production
```

Both wrap `scripts/deploy-pages.sh` (handles Node 22 switch for wrangler). Auth via
`wrangler login` or a `CLOUDFLARE_API_TOKEN` with Pages:Edit on the project's account.

CI's `.github/workflows/deploy-pages.yml` ("Verify Pages Deploy") does **not** deploy — it
waits for CF's build of the pushed commit, then asserts production serves a raster OG image
and a valid AASA document. No Cloudflare secrets needed. (It used to run a redundant
`wrangler pages deploy` that failed every run with CF API error 7003 on stale `CLOUDFLARE_*`
secrets; the CF Git integration, not that workflow, ships prod.)
