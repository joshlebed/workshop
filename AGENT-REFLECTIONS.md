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
