# HighScore migration plan

> All three decisions in §1 are **locked** (Josh, 2026-08-25). Plan is **ratified** —
> implementation can start with Phase 0.

**Goal**: split the product into two brands on one backend. **HighScore**
(`highscore.live`, new iOS app) owns all daily-game functionality; **Workshop**
(`workshop-a2v.pages.dev`, existing iOS app) keeps everything else (lists, watchlist,
sharing, friends-for-lists). One backend, one Postgres, one shared user identity —
sign in with Apple on either app and you get the same account/profile.

Status: **ratified** — see the phase list in §3 for current progress.

---

## 1. Decisions (all locked 2026-08-25)

1. **Two Expo codebases, not four clients.** `apps/highscore` and `apps/workshop`, each
   building web + iOS from one component tree via react-native-web (exactly how
   `apps/workshop` works today). The "5 codebases" become: `apps/backend`,
   `apps/highscore` (web + iOS), `apps/workshop` (web + iOS), plus shared `packages/*`.
   Splitting web and iOS into separate repos-within-the-monorepo would double every
   surface's maintenance for no benefit — Metro's `.web.tsx` resolution already handles
   platform divergence.
2. **New bundle id + EAS project for HighScore.** Proposed: `live.highscore.app`
   (bundle id), new EAS project under `@joshlebed`, new App Store listing "HighScore".
   Workshop keeps `dev.josh.workshop` untouched — no App Store migration for existing
   users.
3. **Shared identity via multi-audience token verification, no data migration.** Apple's
   `sub` user identifier is stable **per Apple developer team**, not per app — the same
   Apple ID signing into both apps produces the same `sub`, so the existing
   `(provider, provider_user_id)` identity rows already match. Backend change is: accept
   a _set_ of valid audiences (both bundle ids + both Services IDs) instead of one.
   Same shape for Google (new iOS client ID + web client ID added to the accepted list).
   In plain terms: Apple's sign-in token says _who you are_ (same ID across all our
   apps) and _which app it was issued for_; accounts are keyed on the former, and the
   backend's only change is accepting the new app in the latter check.

Also to confirm: HighScore app display name, icon direction, and whether the backend gets
a vanity domain (`api.highscore.live`). Recommendation: **skip the API domain for now** —
both webs already proxy `/api/*` same-origin through Pages, and native clients use the
API Gateway URL from config; a vanity domain adds a cert + DNS + CORS surface for zero
user-visible benefit.

## 2. Target architecture

```
highscore.live            → CF Pages project "highscore"  → apps/highscore (web)
workshop-a2v.pages.dev    → CF Pages project "workshop"   → apps/workshop (web)
HighScore iOS (new)       → EAS project highscore         → apps/highscore
Workshop.dev iOS (exists) → EAS project workshop          → apps/workshop
                 all four → one Hono Lambda + Neon Postgres (apps/backend)
```

- **Feature split**: Games tab, score paste loop, standings, `/g/:token` play links,
  game-share OG cards → HighScore. Lists, items, tags, list-sharing, activity,
  album shelf → Workshop. **Friends graph is shared** (it powers both game standings and
  list membership) — both apps render friends UI against the same endpoints.
- **Shared code** moves down into packages: `@workshop/shared` (types, already exists),
  plus extract `packages/ui` (design system: Sheet, Text, ThemeProvider, TagEditor…),
  `packages/api-client` (apiRequest, query keys, session/auth bootstrap, storage).
  Extraction happens incrementally — only what HighScore actually imports.

## 3. Phases

### Phase 0 — Accounts & registrations (manual, no code)

- Apple Developer Portal: new App ID `live.highscore.app` + Sign in with Apple
  capability; new Services ID for web auth; App Store Connect listing shell.
- Google Cloud Console: new iOS OAuth client (HighScore bundle id) + add
  `https://highscore.live` to the web client's authorized origins/redirects.
- Cloudflare: new Pages project `highscore`; attach custom domain `highscore.live`
  (DNS is already on Cloudflare — one-click).
- EAS: new project for HighScore (`eas init` in the new app dir).

### Phase 1 — Backend: multi-app auth + CORS (deploy first, invisible to users)

- `APPLE_BUNDLE_ID`/`APPLE_SERVICES_ID`/`GOOGLE_IOS_CLIENT_ID` become lists (env stays
  string, comma-separated; parsed in `lib/config.ts`; Terraform vars + SSM updated).
- Token verification in `lib/oauth/apple.ts` / `google.ts` accepts any configured
  audience. Session issuance unchanged — sessions are app-agnostic already.
- CORS: add `https://highscore.live` + HighScore Pages preview pattern to
  `STATIC_ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_PATTERNS` in `app.ts`.
- Backend is already brand-neutral (`/v1/*`); no route changes. Games endpoints stay put.

### Phase 2 — Monorepo restructure: scaffold `apps/highscore`

- Extract shared UI + api-client packages (only what both apps need; respect the
  "runtime imports via subpath, not barrel" Metro constraint).
- Scaffold `apps/highscore`: Expo app, scheme `highscore`, bundle id from Phase 0,
  `associatedDomains: applinks:highscore.live`, its own `app.json` version line.
- Move (not copy) the Games surfaces from Workshop into HighScore: Games tab,
  `share/pick-game`, score paste loop, StandingsCard/DayRail, `/g/:token` route.
  Workshop keeps compiling with games code deleted behind a feature-flag branch until
  Phase 5 cutover (so both apps can ship independently).

### Phase 3 — HighScore web live on `highscore.live`

- Wire CF Pages Git integration for the new project (build `apps/highscore`, its own
  `functions/` dir with the game-share + friend-invite OG cards and `/api/*` proxy).
- OG assets rebranded; `scripts/check-og.mjs` extended to cover the new domain.
- New `/g/:token` links mint against `highscore.live`. Old `workshop-a2v.pages.dev/g/*`
  and `/friends/accept/*` URLs **must keep working** (iMessage history) — Workshop's
  Pages functions 301 them to `highscore.live` equivalents.

### Phase 4 — HighScore iOS: TestFlight → App Store

- EAS build config, ASC API key reuse (same team), new `testflight-highscore.yml`
  (clone of `testflight.yml` with per-app fingerprint tags, e.g. `hs-ios-fp-<hash>`).
- Associated domains + AASA served from `highscore.live` for universal links.
- TestFlight validation pass (sign in with the same Apple ID used on Workshop →
  confirm profile carries over), then App Store review submission. **Review is the
  long pole (1–7 days) — start as early as the build is credible.**

### Phase 5 — Workshop cutover: remove games, point users at HighScore

- Existing Workshop users first learn about HighScore here: once the App Store listing
  is live, the Workshop games tab is replaced (via OTA) with a **persistent** "Daily
  games moved to HighScore" surface deep-linking to the App Store listing / web app —
  not a dismissable one-time notice.
- Bump `app.json` version (native-adjacent churn; runtime-version guard will demand it),
  ship TestFlight + OTA per the existing pipeline.
- Web: Workshop Pages functions keep the `/g/*` redirects from Phase 3.
- **No downtime required** — every phase is additive until this one, and this one is a
  client-side removal. The user notification is "games are moving", not "outage".

### Phase 6 — CI/CD generalization

- `ci.yml`: extend path filters + Metro-bundle check to both apps (matrix or duplicated
  job); mirror any new required-check names into `ci-docs.yml`.
- `deploy-mobile.yml` (OTA), `runtime-version-guard.yml`, `ios-capabilities-guard.yml`:
  per-app variants or matrixed with per-app fingerprint tag namespaces.
- `deploy-pages.yml` verify job covers both Pages projects (OG + AASA on both domains).
- Terraform: new/changed env vars for audience lists; no new AWS resources expected.

### Phase 7 — Launch & follow-through

- Announce (Discord/app notice) with dates; publish HighScore listing; monitor Lambda
  errors + auth failures for a week (`scripts/logs.sh --filter error`).
- Docs sweep: CLAUDE.md files, README, admin runbook, this file marked done.
- Cleanup PRs: delete dead Workshop games code, retire the temporary feature flag.

## 4. Sequencing & risk

- **Order matters**: 0 → 1 → 2 → (3 ∥ 4) → 5 → 7; Phase 6 lands incrementally alongside
  2–5. Phases 3 and 4 are independent once 2 lands.
- **Top risks (3)**: App Store review rejection/delay for a games-adjacent app that has
  no games _content_ of its own (mitigate: seed the catalog, screenshots showing real
  standings); Apple/Google auth misconfig locking out one surface (mitigate: Phase 1
  ships weeks before clients, tested with both existing audiences); cached share links
  in iMessage pointing at retired Workshop game routes (mitigate: permanent redirects,
  never 404).
- **Rollback**: each phase is a normal PR; Phase 5 is the only user-visible removal and
  reverts via OTA within ~60s.
