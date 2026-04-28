# AGENT-REFLECTIONS.md

Running notes from coding agents (Claude Code on Niteshift, etc.) on what
the workshop dev environment makes easy vs. what burns time. Each entry
focuses on a specific area; the goal is for the next agent (or the human
maintainer) to spot patterns across sessions and fix the ones that
recur.

## How to contribute

1. **Add a new section per session**, headed with the date and a short
   topic (e.g. `## 2026-04-28 — auth in dev`). Don't edit existing
   sections — they're a snapshot of how things worked at that point.
2. **Use this shape inside each section**:
   - **What went well** — concrete things that saved time or worked
     first try. Cite file paths and commands.
   - **What didn't go well** — concrete friction. Be specific: which
     command, which error, how long it took to diagnose. Avoid vague
     "the docs were confusing".
   - **Actionable feedback** — what could change in the codebase, the
     `niteshift-setup.sh`, `CLAUDE.md`, or the per-area guides to make
     this less painful next time. Each item should be a concrete
     edit a maintainer or future agent can make.
3. **Keep it scoped.** One area per section. If a session touches
   auth, infra, and CI, write three sections.
4. **Don't editorialize.** Stick to observed behavior. "X took 15 min
   because Y" is useful; "the env is bad" is not.

If a recurring complaint shows up across three or more sessions, that's
a strong signal to land a fix; consider promoting it from this file
into `CLAUDE.md` (for repeat-worthy gotchas) or a follow-up issue.

---

## 2026-04-28 — auth in dev (Phase 4a-1 share-flow chunk)

Context: implementing `app/share/pick-list.tsx` + a Playwright happy-path.
The chunk itself was small, but exercising the e2e path required
sign-in, which surfaced the auth-config friction below.

### What went well

- **`CLAUDE.md` "Signing in locally (no email)" section** —
  `grep "magic code" "$NITESHIFT_LOG_FILE" | tail -1` is documented
  and worked first try. Saved ~5 min vs. spelunking through backend
  source.
- **`apps/workshop/src/config.ts` deriving the API URL from
  `window.location` on web** — handled the Niteshift preview-proxy
  CORS preflight gotcha invisibly. The CLAUDE.md note explaining why
  saved me from "fixing" it.
- **The `sign-in-dev` testID + `tests/e2e/helpers.ts`
  `disableAutoDevSignIn` helper** — once they're wired correctly, the
  Playwright pattern is clean: opt out of boot-time auto-sign-in via
  `localStorage.workshop.disable-auto-dev`, click the dev button,
  proceed. Mirroring this in the new `share-pick-list.spec.ts` was a
  copy-paste.
- **Platform-split storage (`storage.ts` vs. `storage.web.ts`)** —
  zero conditionals; the `.web.ts` extension does the work. No auth
  fallout from running in the web bundle.

### What didn't go well

- **Niteshift sandbox dev servers don't bake the dev-auth env vars.**
  `scripts/e2e.sh` sets `DEV_AUTH_ENABLED=1` (backend) and
  `EXPO_PUBLIC_DEV_AUTH=1` (web bundle); `niteshift-setup.sh` does
  not. Symptom: `sign-in-dev` testID is absent in the user's preview
  iframe and in any fresh `agent-browser` session pointed at the
  sandbox. First e2e run failed because I assumed the sandbox-running
  servers were e2e-ready. Diagnosis path: read `scripts/e2e.sh`,
  `apps/workshop/src/hooks/useAuth.tsx`
  (`process.env.EXPO_PUBLIC_DEV_AUTH !== "1"` early return),
  `apps/backend/src/routes/v1/auth.ts` to confirm the matching
  backend gate. ~10 min to root-cause.
- **Recovery required killing + restarting niteshift servers.** Had
  to `pkill` the niteshift `concurrently` / `tsx watch` /
  `expo start` processes, run `pnpm run e2e` (which spins up its own
  servers with the correct env), then restart `niteshift-setup.sh` in
  the background to restore the user's preview. Fragile: if the user
  reloads the preview during the gap they see a broken page.
- **Two parallel "dev modes" with different env contracts is a
  footgun.** `pnpm dev` (local), `niteshift-setup.sh` (sandbox), and
  `scripts/e2e.sh` (e2e) each set up env independently. The dev-auth
  flags are present in #3, absent in #2, and depend on a developer's
  local `.env` for #1. There's no single source of truth.
- **`needs-display-name` state is sticky in e2e.** The
  `dev@workshop.local` account persists `display_name` across specs
  in the same batch. The `sign-in.spec.ts` flake noted in §3.21 /
  §3.22 of `docs/redesign-plan.md` is downstream of this. Not a
  blocker for 4a-1 but kept costing a re-read of the failure to
  confirm "yes, still that flake".

### Actionable feedback

1. **Bake dev-auth env vars into `niteshift-setup.sh`.** Add
   `DEV_AUTH_ENABLED=1` to the backend's exec env and
   `EXPO_PUBLIC_DEV_AUTH=1` to the web bundle's. The sandbox is
   already a non-prod environment; making the dev-sign-in button
   available there matches developer expectation and removes the
   "kill servers / run e2e / restart servers" ritual. Either always
   on, or gated behind a sandbox-only check (`$NITESHIFT_TASK_ID`
   present, etc.).
2. **Centralize the dev-auth env contract.** Either a single
   `.env.dev-auth` file sourced by all three contexts (`pnpm dev`,
   `pnpm e2e`, `niteshift-setup.sh`) or a documented matrix in
   `apps/workshop/CLAUDE.md` listing which env var enables which
   capability in which mode. The `EXPO_PUBLIC_*` audience vars
   (Apple/Google) already have CLAUDE.md coverage; the dev-auth
   flags should sit alongside them.
3. **Reset `dev@workshop.local` between e2e specs.** A
   `beforeEach`-level `DELETE /v1/auth/dev/reset` route (or a direct
   DB scrub) would kill the §3.21 / §3.22 flake. Cheaper than
   per-spec unique-email generation since the existing specs all
   assume the canonical dev account. Belongs in a Phase 5 polish
   chunk (`docs/redesign-plan.md` §3 already lists Playwright
   coverage as a Phase 5 deliverable).
4. **Hoist the "dev sign-in flow" pattern into a dedicated test
   helper.** Right now each new spec re-implements:
   `disableAutoDevSignIn` → click `sign-in-dev` →
   `Promise.race([display-name, home-greeting])` →
   conditionally fill `display-name-input`. A
   `signInAsDev(page, { displayName? })` helper in
   `tests/e2e/helpers.ts` would shrink each spec by ~10 lines and
   make the recovery path consistent. Low-effort, high-leverage.
5. **Add a one-liner to `apps/workshop/CLAUDE.md` (or create
   it)** pointing at `scripts/e2e.sh` as the canonical reference for
   "what env vars does the auth dev flow actually need". The
   top-level `CLAUDE.md` covers the magic-code lookup but doesn't
   call out the `EXPO_PUBLIC_DEV_AUTH` / `DEV_AUTH_ENABLED` pair.

### Friction → fix sketches (size estimates)

| Friction                          | Fix                                                     | Size |
| --------------------------------- | ------------------------------------------------------- | ---- |
| Sandbox dev-auth flags missing    | Add 2 env exports to `niteshift-setup.sh`               | ~5m  |
| Three contexts, three env setups  | `.env.dev-auth` + source it from all three              | ~30m |
| `dev@workshop.local` sticky state | New `POST /v1/auth/dev/reset` route + `beforeEach` call | ~1h  |
| Each spec re-implements sign-in   | `signInAsDev(page)` helper                              | ~30m |
| Env-var matrix not documented     | 8-line table in `apps/workshop/CLAUDE.md`               | ~15m |

---

## 2026-04-28 — deferring Phase 4a-2 (planning-doc-only PR)

Context: `/continue-redesign` selected 4a-2 (native iOS share extension)
as the next pickup per the "first Pending chunk with no unmet External
deps" rule. Halted before writing code; the human confirmed the chunk
should be deferred until Phase 5 polish lands. This PR is plan-doc
edits only — no code, no tests, no CI hooks.

### What went well

- **The skill's "Halt and surface" rubric was the right gate.** The
  rubric in `/continue-redesign` ("requires external setup", "much
  bigger than scoped") matched 4a-2 cleanly: manual TestFlight smoke
  test on a real iPhone, EAS free-tier minute consumption, and an
  architectural choice (off-the-shelf vs vendor a config plugin).
  Posting the summary _before_ writing any code saved the session
  from burning ~1–2h of native-iOS work that would have landed
  unverified.
- **The §3.24 ("What 4a-2 should do _first_") section preserved
  full implementation context.** Deferring didn't require deleting
  the guidance — it stays parked in place for whenever 4a-2 is
  revisited. Net: no information lost.
- **Phase decomposition pattern was easy to extend.** §3.23 already
  had the chunks-table format; adding §3.25 for Phase 5 chunks took
  a single Edit using the same column shape (Chunk / What ships /
  External deps / Status). The next agent gets a clear pickup target
  (5a — offline cache) without me having to write any of the polish
  code.

### What didn't go well

- **Section numbering in `docs/redesign-plan.md` is non-sequential
  and getting confusing.** §3.9 ("Original Phase 1 deliverable list")
  appears _after_ §3.24 in document order; the §3.x numbers reflect
  insertion order rather than narrative position. I added §3.25 for
  Phase 5 chunks; it's adjacent to §3.24 in document order but the
  out-of-order §3.9 still sits between §3.25 and the Phase 5
  narrative further down. Not blocking, but a future agent looking
  for Phase 5 has to scroll past three unrelated sections to find
  the chunks table → narrative → acceptance criteria flow.
- **No automated way to verify "Status" cells in the chunks tables
  match reality.** I changed 4a-2 from `Pending` to `Deferred` by
  hand-editing the table. A typo or stale Status would not be caught
  by `pnpm typecheck` / `lint` / `test`. The "Current status" prose
  near the top of the doc and the §3.x table for the same chunk can
  drift silently.

### Actionable feedback

1. **One-time renumber pass on §3 subsections.** Renumber the §3.x
   sections so document order matches narrative order
   (Phase 0 chunks → Phase 0 retros → Phase 1 chunks → Phase 1
   retros → ... → Phase 5 chunks → Phase 5 retros). Not urgent;
   becomes painful around Phase 5 if 5a–5f all land back-to-back
   with their own retro sections at the bottom.
2. **Add a status-consistency lint to CI.** A small Node script
   (~30 lines) that parses the chunks tables in §3 and the
   "Current status" / "Pending" / "Next to implement" sections at
   the top, then asserts they reference the same chunks with the
   same Status. Drops a class of plan-vs-reality drift bugs that
   only get caught by the next agent reading the plan from cold.
3. **Document the "defer" precedent in `/continue-redesign`.** The
   skill currently has "Halt and surface" but doesn't describe the
   _outcome_ shape when a chunk is deferred (plan edit, no code).
   Adding a one-paragraph note like "If the human chooses to defer
   the chunk, the PR is plan-doc-only: mark the chunk's Status as
   `Deferred` in its §3.x table with a rationale subsection, update
   the top-level pointers, and pick a new next chunk in the same
   PR" would shrink the mental load for a future "halt → defer"
   loop.

### Friction → fix sketches (size estimates)

| Friction                           | Fix                                                      | Size |
| ---------------------------------- | -------------------------------------------------------- | ---- |
| §3 subsection numbers out of order | One-time renumber pass on `docs/redesign-plan.md` §3.x   | ~30m |
| Chunks-table Status drift          | Node script in `scripts/lint-redesign-plan.ts` + CI step | ~1h  |
| "Defer" outcome shape undocumented | Add a paragraph to `/continue-redesign` skill            | ~10m |

---

## 2026-04-28 — Phase 5a offline cache (TanStack persist + Metro/NodeNext fight)

Context: implementing chunk 5a — wire `persistQueryClient` into the app
so previously-fetched query data survives a cold start, plus a global
"You're offline. Retry?" toast. New files in `apps/workshop/src/lib/`
(`persister.ts`, `persister.web.ts`, `offline.ts`, `OfflineRetryWatcher.tsx`),
edits to `query.ts` + `app/_layout.tsx`, 4 vitest cases for the buster
key, and an export of `SHARED_TYPES_VERSION` from `@workshop/shared`.

### What went well

- **`@tanstack/query-async-storage-persister` +
  `@tanstack/query-sync-storage-persister` dropped in cleanly via
  `npx expo install`.** Once I pinned the versions to match the
  existing `@tanstack/react-query@5.100.1` (the persister packages
  default to `5.100.5` which has a strict peer-dep), the install was
  one shot. No native rebuild required for AsyncStorage either — the
  package was already implicitly available via the Expo SDK.
- **The platform-split file pattern (`persister.ts` for native,
  `persister.web.ts` for web) made the storage divergence trivial.**
  Metro picks the right one per bundle; no `Platform.OS` branches in
  shared code. Mirrors the existing `storage.ts` / `storage.web.ts`
  split for `expo-secure-store` vs `localStorage`. ~5 min to wire.
- **Existing optimistic-update infra (1b-2) plugged into the new
  offline path with zero per-component churn.** The
  `MutationCache.subscribe()` listener in `OfflineRetryWatcher.tsx`
  picks up _any_ failed mutation and surfaces a global "Retry?" toast
  — the per-mutation `onMutate` / `onError(ctx.previous)` logic
  already in place handled the rollback cleanly. No need to edit
  every mutation site.
- **Vitest `2.1.9` matched backend's pin exactly.** No version
  alignment work; `pnpm run test` worked first try in
  `apps/workshop/`.
- **e2e suite stayed green (8/8).** Once the bundling break (below)
  was fixed, the full Playwright run passed in ~12s including the
  previously-flaky `sign-in.spec.ts`.

### What didn't go well

- **Metro vs NodeNext `.js`-extension fight burned ~10 min.** The
  most painful part of the chunk. My first cut put a
  `import { SHARED_TYPES_VERSION } from "@workshop/shared"` at module
  scope in `apps/workshop/src/lib/query.ts`. Metro then tried to
  resolve `packages/shared/src/index.ts`'s `export * from "./types.js"`
  and failed with `Unable to resolve "./types.js"`. The shared
  package's barrel uses `.js` because `apps/backend` is on
  `moduleResolution: "NodeNext"` which _requires_ explicit
  extensions. Drop the `.js` and backend typecheck breaks (TS2835).
  The trap was invisible from the existing code because every other
  importer of `@workshop/shared` from the mobile app uses
  `import type` only (which Metro elides). Diagnosis path: read the
  Metro stack trace → check `packages/shared/src/index.ts` → cross-
  check `apps/backend/tsconfig.json` `moduleResolution`. Fix: revert
  the shared barrel; mirror the constant locally in
  `query.ts` as `PERSIST_TYPES_VERSION = "1"`; add a vitest
  lock-step assertion (`expect(PERSIST_TYPES_VERSION).toBe(SHARED_TYPES_VERSION)`)
  that runs in Node where the import _does_ work. Solid workaround,
  but the next agent who tries to runtime-import from
  `@workshop/shared` will hit the same wall.
- **Dev server died mid-`pnpm install`.** The background
  `niteshift-setup.sh` was running `concurrently` with `tsx watch` /
  `expo start`; my `pnpm install` for the new persister packages
  raced node_modules and killed both. Recovery required
  `source /.env.setup && nohup bash ~/.niteshift/niteshift-setup.sh`
  — the env vars don't auto-source in fresh shell sessions, and the
  first restart attempt without sourcing failed with
  `DATABASE_URL: unbound variable`. ~3 min of wasted recovery.
- **`scripts/e2e.sh` conflicts with running dev servers.** The e2e
  script spawns its own backend (8787) and web (8081) on the same
  ports the Niteshift sandbox is already using for the live preview.
  Required killing the sandbox servers before running e2e, then
  restarting them after. Same pattern as the prior session's auth-in-
  dev friction; still no clean detect-and-reuse path.

### Actionable feedback

1. **Add a Metro/NodeNext gotcha to `CLAUDE.md`.** A short section
   under "Conventions" along the lines of: "Don't add runtime
   imports from `@workshop/shared` to mobile/web packages — the
   barrel uses `.js` extensions for backend's NodeNext requirement,
   but Metro can't resolve them. Mirror the constant locally and
   gate with a vitest lock-step test (see `query.ts` /
   `query.test.ts` for the pattern)." ~5 min edit, prevents the
   exact 10-min trap I hit.
2. **Add an `exports` map to `packages/shared/package.json`** that
   exposes a `.ts` subpath alias resolvable by Metro (e.g.
   `"./constants": "./src/constants.ts"`). Then runtime imports
   of pure-JS constants from shared become possible without the
   extension dance. Bigger fix (~30m) but unlocks the natural
   pattern instead of working around it.
3. **Have `niteshift-setup.sh` source `/.env.setup` itself.** One
   line at the top: `source /.env.setup`. Removes the recovery
   ritual where a fresh shell can't restart the dev servers because
   `DATABASE_URL` isn't set. ~2 min.
4. **Document the e2e/dev-server port conflict in
   `apps/workshop/CLAUDE.md` (or wherever the e2e flow gets a
   dedicated guide).** A 3-line note: "e2e uses the same 8787 / 8081
   ports as `pnpm dev`; kill any running dev server first or e2e
   will hang on port-in-use." ~5 min. Better fix: have
   `scripts/e2e.sh` detect the conflict and either kill or reuse,
   but that's ~30m and behavior-changing.
5. **Consider auto-skipping mutation persistence in
   `getPersistOptions()`.** I set `shouldDehydrateMutation: () =>
false` because failed mutations don't need to survive a cold
   start (they're transient; serializing variables is messy). This
   is the right default for this app and probably for most apps.
   The TanStack docs don't make it the default, so an inline comment
   in `query.ts` explaining why is worth keeping. (Already present.)

### Friction → fix sketches (size estimates)

| Friction                             | Fix                                                         | Size |
| ------------------------------------ | ----------------------------------------------------------- | ---- |
| Metro can't resolve `.js` re-exports | `CLAUDE.md` gotcha note                                     | ~5m  |
| ↑ same                               | Add `exports` map to `packages/shared/package.json`         | ~30m |
| `DATABASE_URL` unbound on restart    | `source /.env.setup` at top of `niteshift-setup.sh`         | ~2m  |
| e2e/dev port conflict undocumented   | 3-line note in `apps/workshop/CLAUDE.md` (or new e2e guide) | ~5m  |
| ↑ same                               | `scripts/e2e.sh` detect-and-reuse logic                     | ~30m |

---

## 2026-04-28 — Phase 5b light theme tokens chunk

Context: chunk 5b of the redesign — restructure
`apps/workshop/src/ui/theme.ts` to support `darkTokens` / `lightTokens`,
add a `ThemeProvider` driven by `useColorScheme()`, and snapshot both
palettes. Quick chunk in absolute terms; most of the friction was
reading the plan vs. the code and realizing they disagreed.

### What went well

- **Vitest config + script were already in place from 5a.** The
  `vitest.config.ts` glob (`src/**/*.test.ts`) picked up
  `src/ui/theme.test.ts` with zero ceremony — `pnpm test` from
  `apps/workshop/` ran the new file plus the existing `query.test.ts`
  in ~3s. No config edits, no jest-vs-vitest fight.
- **Inline snapshots in vitest are nicer than separate snapshot
  files for tiny resolved-token objects.** `toMatchInlineSnapshot()`
  keeps the expected hex values right next to the test, so a future
  designer pass that tweaks `palette` will see the diff in the same
  PR as the test update. Used here for both `darkTokens` and
  `lightTokens`.
- **`scripts/check-redesign-plan-status.mjs` caught my framing
  draft.** Ran it after rewriting "Next to implement" prose; it
  validated that the §3.26 chunks table and the prose now both name
  5c. Took 200ms. Worth running before every plan-doc PR — it's
  faster than mental cross-referencing.
- **Knip's "duplicate exports" warning is precise enough to fix in
  one edit.** Knip output `darkTokens|tokens apps/workshop/src/ui/theme.ts`
  pinpointed the exact problem: `export const tokens = darkTokens;`
  alongside `export const darkTokens = ...`. Switching to
  `export { darkTokens as tokens };` made knip happy without changing
  any consumer call sites. Took ~3 min from warning to clean.

### What didn't go well

- **The plan and the code disagreed about a foundational invariant.**
  §3.26 says "no new component code — every primitive already reads
  from semantic tokens" and §3.27's "What 5b should do _first_"
  says `tokens = { dark: {...}, light: {...} }`. In reality, every
  primitive imports the static `tokens` export at module load
  (StyleSheet captures values on `create()`); switching to
  `tokens.dark.bg.canvas` would require migrating ~491 call sites
  across primitives + screens, well outside a "no new component
  code" chunk. Spent ~15 min re-reading the plan to convince myself
  the deviation was right, ~10 min implementing the
  backward-compat alias, and ~10 min documenting the deviation in
  §3.28. The architectural plumbing landed; the visible flip
  (primitives reading `useTheme()` at render time) is now a
  follow-up chunk that doesn't exist in §3.26 yet.
- **Provider name collision with `@react-navigation/native`.** The
  `_layout.tsx` already imported `ThemeProvider` from
  `@react-navigation/native`. Adding our own meant aliasing one of
  them; chose `NavigationThemeProvider` for the navigation one and
  `ThemeProvider` for ours (matches the spec naming). Easy fix
  (~5 min) but the kind of thing static-analyzers would catch as a
  shadowed import — would help to flag at PR time.
- **`useColorScheme` returning literal `null` on web during the
  first render.** `react-native`'s typing has it as `"light" |
"dark" | null | undefined`; my first cut did
  `scheme === "dark" ? darkTokens : lightTokens` which silently
  flipped the app to light on web until `prefers-color-scheme`
  resolved. Defaulted to dark explicitly on null/undefined to
  preserve the existing visual baseline. Worth a one-line note in
  any future "useColorScheme on web" gotcha doc.

### Actionable feedback

1. **Update the §3.26 plan to drop the "no new component code"
   claim or re-scope 5b to include primitive migration.** As shipped,
   5b lands the architecture but doesn't visibly flip primitives —
   it ships the door and leaves the wiring to a follow-up. If the
   intent was a visible flip, the chunk needs a primitive-migration
   sibling (call it 5b'). ~5m doc edit.
2. **Add a `useTheme()`-based primitive migration chunk to §3.26.**
   Concrete deliverable: rewrite each `apps/workshop/src/ui/*.tsx`
   primitive to call `useTheme()` in render and inline its
   StyleSheet (or memoize via `useMemo`). Mechanical change; ~30m
   per primitive × 12 primitives ≈ 6h. Could also include screen
   migration (491 → fewer call sites once primitives stop
   importing `tokens` directly). Fits between 5b and 5c if the
   visible flip matters.
3. **CLAUDE.md "useColorScheme on web returns null first" note.**
   2 lines: "On web, `useColorScheme()` resolves to `null` on the
   first render before `prefers-color-scheme` hydrates. Always
   default to your baseline mode rather than treating `null` as
   light." ~3m edit, prevents one specific footgun.
4. **No friction around `scripts/check-redesign-plan-status.mjs`.**
   Already documented; ran cleanly. Nothing to change here, just
   keep it in the skill loop.

### Friction → fix sketches (size estimates)

| Friction                                                           | Fix                                                                          | Size |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---- |
| Plan said "no new component code" but primitives use static tokens | Update §3.26 5b deliverable wording or scope a 5b' primitive-migration chunk | ~5m  |
| Primitives still bind to dark `tokens` after 5b                    | New chunk: migrate each `src/ui/*.tsx` primitive to `useTheme()` in render   | ~6h  |
| `useColorScheme()` returns `null` on web first render              | One-line note in `CLAUDE.md` under "Conventions" or "Local development"      | ~3m  |
| `@react-navigation/native` ThemeProvider name collision            | One-shot rename happened cleanly; no codebase-wide fix needed                | n/a  |

## 2026-04-28 — list-detail "new items" pill (Phase 5c)

Context: implementing `apps/workshop/src/ui/NewItemsPill.tsx` +
wiring into `app/list/[id]/index.tsx` for the spec §12 polish item.
Self-contained chunk; no infra or external services touched.

### What went well

- **§3.28's "Known constraints for 5c" was load-bearing.** It
  spelled out that primitives still bind to the static `tokens`
  export and that new visible color in 5c+ should use
  `useTheme()`. Without that hint I'd have copy-pasted the
  `import { tokens } from "./theme"` pattern from `Chip.tsx` and
  shipped a primitive that doesn't flip with theme. ~10m saved
  by reading the prior chunk's "Known constraints" block before
  writing code. This is the §3 hand-off pattern paying off — keep
  it up.
- **`computeNewItemsDelta` as a pure helper made vitest trivial.**
  4 cases, no React, no mocks. Same convention as `query.test.ts`.
  `apps/workshop/vitest.config.ts` already globs
  `src/**/*.test.ts`, so no config edits needed — the test ran
  immediately.
- **Biome's `useExhaustiveDependencies` rule caught the spurious
  `dataUpdatedAt` dep.** The plan said to use it; reality didn't
  need it. Lint flagged it before I had to think about it.
  Saved a follow-up "why is this effect spinning" debugging
  session.
- **`pnpm run typecheck && pnpm run lint && pnpm run test` is
  fast enough to run after every edit.** ~12s typecheck + ~1s
  lint + ~7s test. Tightens the inner loop.

### What didn't go well

- **`pillViewport` `top: 140` is a magic number derived by
  adding up paddings + line heights from memory.** A
  `<View onLayout>` measure on the toolbar would be the right
  primitive ("position 8px below my actual rendered bottom"), but
  it adds a render cycle for a single tweakable constant. Made
  it a magic number with a code comment in the §3.29 doc, but
  flagging here as a concrete spot where RN's lack of
  `position: sticky` (web) bites — sticky positioning would have
  let me drop the absolute viewport entirely. ~5m of fiddling.
- **No good way to E2E this without driving FlatList scroll +
  invalidating a TanStack Query cache mid-render.** Playwright
  can drive scroll, but synthesizing a refetch that lands new
  items requires either bumping the mock + waiting for
  refetch-on-window-focus or hijacking the QueryClient — both
  brittle. Punted to 5f's full sweep, where the test harness
  could expose `__queryClient` as a window global for tests.
  ~10m of "is this worth a spec?" deliberation; would help to
  have a documented testing policy for this kind of internal-state
  primitive.

### Actionable feedback

1. **Add a `useScrollSticky` hook to `apps/workshop/src/lib/`.**
   Wraps the `scrollYRef` + `onScroll` + threshold pattern that
   the pill needed; future chunks (5d sheet enter/exit, 5e
   two-pane sticky pane) probably need the same shape. ~30m,
   one helper + one vitest. Fits as part of 5d or as a tiny
   "5c.1" follow-up.
2. **Document in `CLAUDE.md` the "test what's pure, leave
   integration to E2E or manual" rule explicitly.** Implicit in
   the codebase but not written down; "pure helper goes next to
   its consumer with a vitest, FlatList scroll + query interaction
   gets a Playwright" would have saved ~10m of "should I write a
   spec?" deliberation. ~5m doc edit.
3. **`scripts/check-redesign-plan-status.mjs` ran cleanly and
   caught the format I cared about.** No friction here — this
   is a positive note. The skill loop already calls it.
4. **Phase 5 chunks really are "one PR each" — keep that
   discipline.** It was tempting to also migrate `UpvotePill` to
   `useTheme()` while in the area (it's right there in the
   imports), but that's part of the §3.28 follow-up not 5c.
   Easier to resist when the "What X shipped" section explicitly
   pins scope.

### Friction → fix sketches (size estimates)

| Friction                                                                  | Fix                                                                             | Size |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---- |
| `pillViewport` `top: 140` is a measured magic number                      | Replace with `<View onLayout>` measure on toolbar; expose offset via context    | ~30m |
| FlatList scroll + query refetch interaction is awkward to E2E             | Expose `window.__queryClient` in dev/E2E builds; use it from Playwright         | ~1h  |
| Pattern "ref scroll-Y + threshold" likely repeats in 5d/5e                | Extract `useScrollSticky({ threshold })` hook + vitest                          | ~30m |
| "Should I write an E2E spec for this primitive?" decision is undocumented | Add a `CLAUDE.md` line: "pure helper → vitest; FlatList/query interaction → 5f" | ~5m  |
