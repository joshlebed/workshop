# AGENT-REFLECTIONS.md

The outstanding-issues queue for environment / tooling friction agents have hit but
couldn't fix inside a normal PR (setup script, sandbox image, dev orchestration, missing
tooling, slow feedback loops, flaky tests).

This file is **outstanding-only** — entries describe open problems, not history. When you
ship a PR that retires an entry, delete the entry in the same PR. Git log is the audit
trail.

## How to contribute

- **Add an entry** when you hit friction that you can't fix in the current task. Keep it
  terse: symptom, root cause (if known), suggested fix. One issue per entry — if a session
  surfaces three independent things, write three entries.
- **Remove an entry** when the underlying issue is fixed in your PR. If the fix is
  partial, edit the entry down to just the still-open part. Don't archive, don't strike
  through — just delete.
- **Promote to `CLAUDE.md`** when an entry has survived multiple sessions without a code
  fix and probably won't get one soon. The right move is to document the workaround as a
  permanent gotcha and drop the entry here.
- **Don't add** task-specific notes (those belong in the PR description), positive
  reflections ("X worked well"), speculative future-feature ideas, or anything fixable
  inside a normal PR. If it's fixable now, open the PR instead of writing about it.

---

## Outstanding

### Dev / sandbox environment

- **Expo RN DevTools auto-install crashes as root in the sandbox.** Every `expo start
--web` start logs `[FATAL:electron/shell/app/electron_main_delegate.cc:290] Running as
root without --no-sandbox is not supported`. The dev server still serves fine — DevTools
  is the only thing broken — but the `FATAL` line triggers false positives when grepping
  `$NITESHIFT_LOG_FILE` for errors. **Fix:** in `niteshift-setup.sh`, set an env var that
  disables the DevTools auto-install before launching `expo start --web` (verify against
  Expo SDK 55 — candidates: `EXPO_NO_DEVTOOLS`, `CI=1`). If no such flag exists, file an
  `expo-cli` issue: in root/CI/sandbox environments the install attempt should silently
  skip instead of logging FATAL.

### E2E suite

- **`dev@workshop.local` state is sticky across e2e specs.** The user's `display_name`
  persists between specs in the same batch, which is the upstream cause of the
  `sign-in.spec.ts` "dev sign-in → display name → home" flake (the spec assumes a fresh
  user and fails when the display-name screen doesn't render because it's already been
  set). **Fix:** add a `POST /v1/auth/dev/reset` route (gated on `DEV_AUTH_ENABLED=1`)
  that deletes the canonical dev user, then call it from a Playwright `beforeEach`.
  Cheaper than per-spec unique-email generation since the existing specs all assume the
  canonical dev account. ~1h.

- **Dev-auth env-var matrix is undocumented.** `pnpm dev` (local `.env`),
  `niteshift-setup.sh` (sandbox), and `scripts/e2e.sh` (e2e) each set `DEV_AUTH_ENABLED` /
  `EXPO_PUBLIC_DEV_AUTH` independently. There's no single source of truth telling the
  next agent which mode enables which capability via which var. **Fix:** 8-line table
  in `apps/workshop/CLAUDE.md` listing the three modes × two vars. The sandbox already
  bakes the flags; this is purely a "make the contract discoverable" doc edit.

- **Six e2e specs assert the removed `home-greeting` testID.** The greeting was dropped
  when the tab home headers were simplified (#314), so `getByTestId("home-greeting")`
  matches nothing. `signInAsDev` in `tests/e2e/helpers.ts` was moved onto the create-list
  FAB, but `sign-in`, `sign-in-google`, `activity-feed`, `share-link-accept`,
  `games-onboarding`, and `games-social` still assert the greeting inline and time out.
  **Fix:** swap those assertions for `fab-create-list`, or export the module-local
  `goToListsHome` from the same helpers file (it also handles the Games-tab landing).
  ~20min, mechanical.

- **Specs interfere when run as a batch.** `tags-filter`, `saved-views` and
  `add-item-tags` each pass alone but fail when run in one `playwright test` invocation
  (the second spec onward lands on a stale screen / never sees `list-detail-empty-add`).
  Suspected cause is the shared `dev@workshop.local` account accumulating lists plus the
  sticky-state entry above. **Fix:** per-spec dev user (or the `POST /v1/auth/dev/reset`
  route already proposed above), then re-verify a full-suite run.

- **Six e2e specs reference a stale `create-list-type-*` testID.** The create-list
  template picker now renders `create-list-template-${tpl.id}` (`app/create-list/type.tsx`),
  but `list-flow`, `add-search`, `add-link-preview`, `activity-feed`, `share-link-accept`,
  and `share-pick-list` still call `getByTestId("create-list-type-...")` and time out at the
  template step. Only the post-refactor specs (`tags-filter`, `saved-views`) use the current
  id. e2e isn't a required CI check so this has gone unnoticed. **Fix:** sweep the six specs
  to `create-list-template-<id>` (and confirm the `<id>` slugs: `date_ideas`, `movie`, `trip`
  — note `date_ideas` not `date_idea`). ~30min, mechanical.

### CI / deploy

- **A truncated `node_modules` cache save silently breaks every job that restores it.**
  `.github/actions/setup-pnpm` skips `pnpm install` on a cache hit, so a partial save under
  `nm-<os>-<lockfile-hash>` hands every later job an incomplete tree. Seen on PR #371: a
  65.65 MiB entry (a healthy save is ~248 MiB) was missing `@types/node`, so `Quality` failed
  with `error TS2688: Cannot find type definition file for 'node'` on a markdown-only commit
  — while the same code passed on the run that populated the cache. Re-running does NOT help
  (it restores the same bad entry); `gh cache delete <id>` then re-run does. **Fix:** make the
  restore self-validating — after a cache hit, assert a canary path exists (e.g.
  `node_modules/@types/node/package.json`) and fall through to the install step when it
  doesn't, instead of trusting `cache-hit`. ~20min in the composite action.

- **`Mobile Metro bundle` fails on every mobile PR — Expo's version map moved past the
  lockfile.** Its `Verify RN deps match Expo SDK` step runs `expo install --check` and now
  reports `react-native@0.83.6 - expected version: 0.83.10`, exit 1. Reproduces on a clean
  tree (`cd apps/workshop && pnpm exec expo install --check react-native`), so it's Expo's
  remote SDK version map drifting, not any PR's diff. It does **not** block merge — PR #371
  auto-merged with this check red — so the practical damage is a permanently red check that
  trains everyone to ignore CI. **Fix:** land the RN patch bump (the open expo-group
  Dependabot PR #265 is the natural home) together with an `apps/workshop/app.json`
  `version` bump, since a native dep change moves the iOS fingerprint.

- **No CI check enforces `app.json` `version` bump when native deps change.** PR #160
  switched the iOS runtime-version policy from `fingerprint` to `appVersion`, so the
  human-readable `version` field in `app.json` is now what `eas build` and `eas update`
  both target. Forgetting to bump it when adding a native module (or changing a config
  plugin) ships an OTA whose JS references native symbols the already-installed
  TestFlight build doesn't have — the app crashes on next launch and existing users
  have to delete + reinstall to recover. **Fix:** add a `Quality (...)`-tier job that
  diffs `@expo/fingerprint` between PR head and `main`, and fails the run if the
  fingerprint changed without a `version` bump in `apps/workshop/app.json`. Both inputs
  are already computed: fingerprint by `testflight.yml`, version is a one-line `jq`.
  ~30m. The CLAUDE.md gotcha in the iOS deploy pipeline section is the manual
  workaround until this lands.

### Tooling / scripts

- **OAuth provider glue is duplicated between the two apps.**
  `apps/highscore/src/lib/oauth/**` is a verbatim copy of
  `apps/workshop/src/lib/oauth/**` (Apple native + web, Google native + web, the
  `GoogleSignInButton` variants). PR-1 extracted `@workshop/ui` /
  `@workshop/api-client` but left this layer behind, so an Apple/Google flow fix now
  has to land twice. **Why it wasn't extracted in PR-3:** four of the five modules are
  platform variants (`.web.ts(x)`), and Metro does not apply platform resolution to a
  package `exports` target — extraction needs the `src/<name>/index.ts` -> `./impl` shim
  shape (see CLAUDE.md) applied to five modules _and_ Workshop's imports flipped, which
  is a bigger diff than the scaffold PR should carry. **Fix:** extract to
  `@workshop/api-client/oauth/*` (or a new `@workshop/auth-ui`) using the shim shape,
  flip both apps' imports, verify with a `platform=web` and a `platform=ios` Metro
  bundle for each app. ~1h. Natural home: PR-4 or PR-5 of the HighScore migration.

- **`scripts/dev-smoke.sh`** doesn't exist. A single script that hits home, list-detail,
  settings, activity, and sign-in on `localhost:8081`, reports non-200s + console
  errors, and exits non-zero on failure. Would shave ~90s per smoke iteration during UI
  work (vs. one-off agent-browser calls that each rebuild). ~30m + a tiny shell script.

- **`useScrollSticky({ threshold })` hook in `apps/workshop/src/lib/`.** The "ref
  scroll-Y + onScroll + threshold" pattern is already implemented in
  `packages/ui/src/NewItemsPill.tsx`; the Phase 5d Sheet enter/exit and the Phase
  5e two-pane sticky pane will want the same shape. Extract to a hook + a vitest.
  ~30m.

- **`pillViewport top: 140` in `NewItemsPill.tsx` is a magic number.** It was derived by
  adding up paddings + line heights from memory; breaks silently when the toolbar
  height changes. **Fix:** replace with a `<View onLayout>` measure on the toolbar
  exposed via context to children that want to position relative to it. ~30m.

### Docs / planning

- **`docs/redesign-plan.md` §3 subsections are out of document order.** §3.x numbers
  reflect insertion order, so §3.9 ("Original Phase 1 deliverable list") sits between
  §3.25 and the Phase 5 narrative further down. Future agents reading Phase 5 cold have
  to scroll past unrelated sections. **Fix:** one-time renumber pass so document order
  matches narrative order (Phase 0 chunks → Phase 0 retros → … → Phase 5 chunks →
  Phase 5 retros). Low urgency; becomes painful around Phase 5f. ~30m.

- **`/continue-redesign` skill doesn't describe the "defer" outcome shape.** The skill
  has "Halt and surface" but doesn't say what a deferred-chunk PR looks like (plan-doc
  only, mark the chunk `Deferred` in its §3.x table with a rationale, update top-level
  pointers, pick a new next chunk in the same PR). **Fix:** one-paragraph note in the
  skill. ~10m.

- **§3.26 5b deliverable wording disagrees with reality.** Plan says "no new component
  code — every primitive already reads from semantic tokens," but primitives still bind
  to the static `tokens` export at module load and don't flip with theme. **Fix:**
  either reword §3.26 to drop the claim, or add a sibling primitive-migration chunk
  (call it 5b'). ~5m doc edit, or ~6h to actually migrate every primitive to
  `useTheme()` in render.

- **CLAUDE.md testing-policy line is missing.** Implicit but unwritten: "pure helper →
  vitest next to its consumer; FlatList / TanStack-query interaction → Playwright in
  the next chunk with a real caller; Reanimated primitive → manual smoke + Playwright
  at first real caller." Saves ~10m of "should I write a spec?" deliberation per UI
  chunk. ~5m doc edit.

### CI

- **Required-checks drift between `ci.yml` and `ci-docs.yml` is unenforced.** CLAUDE.md
  documents the rule ("if you add a new required check to `ci.yml`, mirror it as a noop
  in `ci-docs.yml`") but nothing fails the build when someone forgets. **Fix:** a tiny
  script in CI that diffs the job names between the two workflows and fails on
  mismatch. ~30m.
