---
name: continue-redesign
description: Pick up the next chunk in `docs/redesign-plan.md`, implement it, document what shipped, and ship the PR. Use this when the user wants an autonomous agent (Niteshift, Claude Code, etc.) to advance the Workshop.dev redesign by one chunk.
---

# /continue-redesign

You are continuing the Workshop.dev redesign described in `docs/redesign-plan.md`. Your job is to take **exactly one chunk** of work to "Done", document what shipped so the next agent has a head start, and ship the PR cleanly.

The plan is the source of truth — but it should also _learn_. If you discover the plan was wrong about something, fix the plan in this PR. Future agents read the same plan you read.

---

## Phase 1 — Discover and scope

1. Read these in order:
   - `docs/redesign-plan.md`. The "Current status" section near the top is your map. Per-chunk tables in §3.1, §3.7, §3.13 etc. show Status.
   - `CLAUDE.md` (top-level conventions, deploy gotchas).
   - The relevant per-area `CLAUDE.md` (e.g. `apps/backend/CLAUDE.md`).
   - The "What [previous chunk] actually shipped" section for the chunk that lands just before yours. That's your real context.

2. **Pick the chunk** you'll work on. Rule: the **first chunk with `Status: Pending`** that has no unmet `External deps`. Tie-break: lower phase number first (0 → 1 → 2 → 3); within a phase, lower letter then lower number (1a-1 → 1a-2 → 1b-1).

3. If multiple chunks are eligible and the dependency graph is unclear, halt and ask. Don't guess.

4. **Before writing any code**, post a message to the human (under 200 words) summarizing:
   - Which chunk you're picking up and the rule that selected it
   - The chunk's deliverables in 1-2 lines
   - What you're explicitly **not** going to do (scope limits)
   - Any flags / questions / anticipated blockers

   Wait for confirmation if running interactively. If running fully autonomously (Niteshift), proceed but include the summary as the first body section of the eventual PR description so a reviewer can sanity-check the framing.

---

## Phase 2 — Execute

5. Implement only the chunk's deliverables. Stick to the file-level deltas in the plan — don't refactor surrounding code, don't bump deps (Dependabot owns that), don't add features the plan doesn't ask for.

6. Verify against the **chunk's Acceptance criteria** (from §3 in the plan), not just `pnpm typecheck`. Specifically:
   - `pnpm run typecheck && pnpm run lint && pnpm run test` — mandatory.
   - `pnpm run knip` — non-blocking but read the output; new findings worth noting.
   - If the chunk has E2E coverage: `pnpm run e2e`.
   - If the chunk touches a backend route: smoke-test with `curl` against `pnpm dev:backend`.
   - If the chunk touches a screen: drive it briefly via Chrome devtools or take a screenshot. UI claims need UI verification.

7. **Don't add scope.** If you discover an unrelated issue:
   - Blocking your chunk → minimal stub or TODO; don't fix it here.
   - Not blocking → note in the PR description as a follow-up.

---

## Phase 3 — Document what actually shipped

This phase is what makes the next agent fast. Do not skip it.

8. Update `docs/redesign-plan.md`:
   - In the chunk table, change the Status from `Pending` to `Done (this PR)`.
   - Add a new `#### What [chunk-id] actually shipped — start here for [next chunk]` section, **mirroring the format of existing such sections** in the plan (look at §3.6, §3.8, §3.10, §3.12, §3.14 for templates). Include:
     - File-level list of what landed (paths + 1–2 lines explaining each)
     - Test counts and pattern (e.g. "29 tests landed; same convention as `lists.test.ts`")
     - Surprises, deviations from plan, gotchas the next agent should know
     - "What [next chunk] should do _first_: ..." pointer
     - "Known constraints for [next chunk]: ..." if applicable
   - Update the "Current status" section at the top: move this chunk Done → Done block, mention the next chunk in "Next to implement".

9. Update `CLAUDE.md` only if you discovered a **repeat-worthy** convention or gotcha. Examples that warrant updates: a new env var Lambda reads, a non-obvious correctness rule, a tool that breaks if not installed, a new "iOS capabilities are config-as-code"-style pitfall. NOT examples: "you should run tests" (already there), "follow the plan" (already implied). Be conservative — every line of CLAUDE.md is read by every future agent.

10. **If the plan was wrong**, fix it in the same PR. Examples: chunk dependencies that turned out to be wrong, file paths that drifted, deliverables that didn't make sense. Note the correction in the PR description. The plan should learn from each chunk.

---

## Phase 4 — Ship

11. Open a PR. Title format (match prior PR titles in `git log --oneline origin/main`):
    - `feat(<area>): land Phase <X-N> — <one-line summary>`
    - or `feat(<area>): <feature> (Phase <X-N>)` for less-template-shaped chunks

12. PR description structure:
    - **Summary**: 2–3 bullets on what landed.
    - **Plan reference**: "Lands chunk X-N from `docs/redesign-plan.md` §3.X."
    - **Test plan**: checklist of acceptance criteria from the plan, plus any manual verification you did.
    - **Follow-ups**: anything deferred, with a 1-line reason for each.

13. **Post a short report to the user before merging.** Before arming auto-merge or merging manually, send a message (under 150 words) summarizing:
    - The chunk that shipped and the PR URL
    - What landed, in 2–3 bullets (file/area level, not line-by-line)
    - Acceptance criteria verified (typecheck/lint/test/manual checks)
    - Any deviations from the plan, follow-ups, or things the human should glance at
    - That you're about to arm auto-merge (or merge manually) unless they say otherwise

    This is the human's last chance to catch a framing issue before the PR lands. If running fully autonomously, still post the report — it lands in the transcript and PR description for after-the-fact review. Don't wait for confirmation in autonomous mode; proceed to step 14 immediately after posting.

14. **Try to arm auto-merge** so the PR self-merges when checks pass:
    `gh pr merge <PR> --auto --squash --delete-branch`. The project uses squash merges (verify: `git log origin/main --oneline -10`); pass `--squash` explicitly so it's not subject to repo defaults changing.

    Auto-merge requires GitHub branch protection to be configured, which on a private repo on the free GitHub plan is unavailable. **If the command fails with `"Auto merge is not allowed for this repository"` or similar, that's the cause — silently fall back to manual merge in step 15.** Don't surface this as a problem; it's just a config gap.

15. Poll CI: `gh pr checks <PR>` until all checks finish.
    - **If auto-merge is armed and required checks pass**: GitHub fires the merge automatically. Verify with `gh pr view <PR> --json state` (should be `MERGED`). Move on.
    - **If auto-merge is NOT armed and required checks pass**: run `gh pr merge <PR> --squash --delete-branch` manually.
    - **A required check fails**:
      - Flake (intermittent timeout, network, dependency download) → `gh run rerun --failed <run-id>` once. If auto-merge was armed, it stays armed and will fire after a successful rerun.
      - Real failure → fix the issue and push another commit. If auto-merge was armed, it stays armed.
      - Two failed attempts from the same root cause → halt and surface to the human. If auto-merge was armed, **disarm it** with `gh pr merge <PR> --disable-auto` so it doesn't fire on a future flaky-pass.
    - Niteshift's `niteshift-check` is intentionally non-required — it's blocking only on the agent's own session, not on merge.
    - Cloudflare Pages preview check is informational; treat it as a hint, not a blocker.

16. Verify the merge triggered the right downstream workflows:
    - Backend changes → `Deploy Backend` runs.
    - Mobile changes → `Deploy Mobile (OTA)` runs; `TestFlight` may run if the iOS fingerprint changed (`@expo/fingerprint` decides).
    - Use `gh run list --branch=main --limit 5` to confirm.
    - **Heads-up: workflow path-filter self-trigger.** If the chunk modified a workflow file (e.g. `.github/workflows/foo.yml`) AND that workflow's own `on.push.paths:` includes the workflow file's filename, merging will trigger that workflow on the merge commit even if no other paths matched. Check both directions when reviewing post-merge runs so you don't get confused by a TestFlight run firing on a CI-only PR.
    - If a deploy fails, surface the failure log to the human — don't try to re-trigger blindly.

17. Final message: 1 short paragraph summarizing what shipped, what the next chunk is, and any human attention required.

---

## What NOT to do

- Don't pick a chunk whose `External deps` aren't met. Halt instead.
- Don't refactor code outside the chunk's deliverables.
- Don't bump dependencies — Dependabot owns that (see `CLAUDE.md`).
- Don't add features the plan doesn't ask for.
- Don't write multi-paragraph commit messages or comments. Match repo style (concise commit subject + a sentence or two of why; comments only when WHY is non-obvious).
- Don't merge with failing required checks.
- Don't claim the chunk is "Done" if any acceptance criterion isn't met. Note the gap in the PR description and ship a partial only with explicit human approval.

---

## When to halt and surface

Halt and ask the human when:

- The chunk requires external setup (Apple/Google portal, AWS, Cloudflare, third-party API keys) the plan doesn't already track in `docs/plans/HANDOFF.md`.
- The plan and code disagree fatally about the prior chunk's state (e.g. the plan claims `1a-2` shipped a route that doesn't exist on `main`).
- A required check fails twice in a row from the same root cause.
- You discover the chunk is much bigger than scoped (>2× estimated effort, or requires architectural decisions not in the plan).
- A migration or destructive operation is implied by the plan but not spelled out.

---

## Why this matters

The plan is read by every future agent. Each chunk that lands well — with a clean "What [chunk] actually shipped" section — saves 15–30 minutes of context-rebuilding for the next agent. Each chunk that lands poorly (Status flipped, no detail) costs the next agent that time _and_ introduces drift between code and plan. Treat the plan as a living artifact; leave it better than you found it.
