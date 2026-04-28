# CI watch items

Things in CI that have shipped but haven't been validated by a real run yet.
Each entry says: what changed, what could go wrong, how to know it broke,
how to revert. Once a real run validates the change, **delete the entry**.

If this file is empty, there's nothing in flight.

---

## TestFlight enqueue: pnpm install removed (PR #97, 2026-04-28)

**Status**: untested. Will be validated by the next push to `main` that changes
the iOS fingerprint (any change to native deps, `app.json`, config plugins,
icons/splash assets, etc.).

### What changed

`.github/workflows/testflight.yml` → `enqueue` job: removed the
`pnpm install` step (along with the pnpm setup and node_modules cache restore
that fed it). The job now does only `actions/checkout` → `actions/setup-node` →
`npx eas-cli@$EAS_CLI_VERSION build …`.

### Why this should work

`eas build` is a remote build. eas-cli zips the project (respecting `.gitignore`
and `.easignore`), uploads it to EAS's servers, and EAS runs `pnpm install`
plus the actual iOS build inside its own sandbox. The local node_modules on
the GitHub runner is unused — eas-cli's build subcommand doesn't import any
project dependencies.

### Why it might not work

If some preflight step in eas-cli (project validation, fingerprint recompute,
plugin discovery) reads from local node_modules, the step fails before upload.
This was reasoned-about, not empirically verified.

### How to tell it broke

The failing step is `Enqueue build + auto-submit` in the `enqueue` job (not
`fingerprint`), and the error mentions a missing local module/package, e.g.:

- `Cannot find module '@expo/...'`
- `expo-modules-core not installed`
- `Failed to read project config`

If TestFlight fails for any other reason (signing, capabilities, EAS submit
queue, App Store Connect 5xx), it's unrelated. Those are documented in
`docs/recovery-runbook.md` and `CLAUDE.md` § "iOS deploy pipeline".

Two signals confirming it's this change specifically:

1. The failing step is in `enqueue`, not `fingerprint`.
2. The error mentions a missing local module — not Apple, not EAS infra.

### Blast radius if it breaks

- Workflow exits non-zero on the enqueue step.
- No fingerprint tag is written.
- No EAS build is enqueued — nothing on the EAS side to clean up.
- Cost: 1 wasted billable minute.
- No production impact (TestFlight build doesn't ship).

### Fix if it breaks

Restore the install in `.github/workflows/testflight.yml`. The simplest
revert is to swap the lone `actions/setup-node` step in the `enqueue` job
back to the composite action (which sets up pnpm, restores cache, and
installs):

```diff
-      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
-        with:
-          node-version-file: .nvmrc
+      - uses: ./.github/actions/setup-pnpm
```

Then retry the build. Per the existing recovery-runbook flow, delete the
fingerprint tag so the next push rebuilds:

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
gh workflow run testflight.yml --ref main --field force=true
```

### Once validated

If the first real native-iOS build after PR #97 succeeds (build URL printed,
fingerprint tag written, EAS build URL in the workflow summary), this entry
can be deleted. Recovers ~30 seconds per native build forever.

The other 5 changes in PR #97 are independent of this one — they validate
on their own paths (next code PR exercises composite action and Terraform
plugin cache; next OTA push exercises `pnpm exec eas update`; next draft PR
exercises the draft skip).
