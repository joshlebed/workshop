# iOS deploy pipeline

Reference document for iOS deploy diagnosis and recovery. Per the canon split, this is
the "load when you're chasing an iOS deploy problem" doc, not every-session context.
Per-symptom incident recovery for TestFlight / EAS lives in `docs/recovery-runbook.md`.

## How iOS code reaches phones

- **JS-only changes** → `eas update` (EAS Update OTA) ~60s after merge to `main`. Phones
  pick it up on next launch.
- **Native changes** → `testflight.yml` runs `eas build --auto-submit` and **awaits the
  build** so CI red/green matches the EAS outcome. Last-built fingerprint stored as
  `ios-fp-<hash>` git tag, written only on success.

## First diagnostic: "feature shipped on web but missing on iOS"

Almost always the deploy pipeline, not per-platform code. Check in order:

1. **Did the OTA ship?** Look at the most recent `Deploy Mobile (OTA)` run on `main`:

   ```bash
   gh run list --workflow=deploy-mobile.yml --branch=main --limit=3
   gh run view <run-id> --log | grep -E "Runtime version|Branch  *production"
   ```

2. **Does the installed TestFlight build's runtime version match the OTA's?** Runtime
   version is `app.json` `version` at build time. A `0.1.0` TestFlight build never
   applies a `0.2.0` OTA.

3. **Has the latest TestFlight build landed?** `testflight.yml` awaits the EAS build —
   a red run means no matching binary exists yet. Two common failure shapes:
   - Fails at the `Write ASC API key` step → the `ASC_API_KEY_*` GitHub Actions secrets
     are unset or stale. Recovery: `pnpm setup:asc-key`.
   - Fails at `Build + auto-submit (await success)` with `Distribution Certificate is
not validated for non-interactive builds` → the ASC API key the secrets point to was
     revoked or doesn't have App Manager+. Rotate the key (same script).

## Runtime-version policy: `appVersion` (not `fingerprint`)

Runtime version = `app.json` `version`. **You MUST bump `version` in the same PR that
adds a native module or changes a config plugin.** No CI guard yet. When in doubt,
bump.

Why this matters: if you add `react-native-foo` (native) at `version: 0.1.0` without
bumping, the new OTA targets `0.1.0`, which the already-installed pre-PR `0.1.0`
TestFlight binary also claims. The OTA applies, then crashes on next launch with
`Native module RNFoo cannot be null` — existing users have to delete + reinstall.
Bumping to `0.2.0` makes the OTA target `0.2.0`, which only post-PR builds claim.

We can't use `policy: "fingerprint"`: EAS's `Configure expo-updates` step fails when
the fingerprint computed pre-submit (Linux runner) disagrees with the one computed
during prebuild (macOS builder) — they disagree because several native package
directories hash differently across OSes. `appVersion` produces identical values on
every host.

## Recovery

### Stuck fingerprint tag (build succeeded but auto-submit failed)

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
gh workflow run testflight.yml --ref main --field force=true
```

### Provisioning profile out of sync after a capability toggle

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# production → Build Credentials → Provisioning Profile → Delete one → confirm
```

Then force a fresh build. EAS regenerates with current capabilities.

### ASC submit queue stuck (IPA fine, downstream broken)

Download IPA from EAS dashboard, upload directly:

```bash
read -s "ASP?Paste app-specific password: " && echo "" && \
  xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa \
    -u joshlebed@gmail.com -p "$ASP" && unset ASP
```

App-specific password: <https://appleid.apple.com> → Sign-In and Security. macOS only.

### ASC API key missing or revoked

Build red at `Write ASC API key`, or at `Distribution Certificate is not validated for
non-interactive builds`:

```bash
pnpm setup:asc-key
```

Interactive script — generates the key in the browser, encodes the `.p8`, pushes the
three GH secrets (`ASC_API_KEY_CONTENT`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`) via
`gh secret set`, and re-fires `testflight.yml --field force=true`. With the secrets in
place eas-cli auto-generates the cert + provisioning profile for any new bundle id
(share / widget / push extension) on the next build with zero human-in-loop.
Idempotent — run again to rotate.

A red `testflight.yml` run also pings `#workshop-admin` on Discord via the `notify`
job (uses `DISCORD_NOTIFY_WEBHOOK_URL` secret; missing webhook degrades to a CI
warning). The ping includes a `pnpm setup:asc-key` hint so the recovery path is one
command away.

## GitHub Actions concurrency

`testflight.yml` uses `concurrency: testflight, cancel-in-progress: false`. Right
default — don't abandon EAS minutes for a new push. But if the in-flight run is stuck,
new runs queue behind it. Cancel with `gh run cancel <run-id>`; the EAS build keeps
running on EAS's servers.
