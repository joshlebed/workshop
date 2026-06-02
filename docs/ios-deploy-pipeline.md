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
not validated for non-interactive builds` followed by `Failed to display prompt: Select
     your Apple Team Type` → **don't rotate the ASC key first.** The most common cause is
     a distribution cert in EAS that was minted interactively (Apple ID + password) before
     the ASC API key was wired in — the API key can't adopt a cert it didn't mint, so
     eas-cli falls through to interactive Apple auth and dies. Open
     `eas credentials --platform ios`; the cert's `Updated` date predating your
     `pnpm setup:asc-key` run is the tell. Recovery is "Distribution certificate out of
     sync" below — delete the cert (not just the PP) and let EAS regenerate via the API
     key. Only rotate the ASC key if (a) the key is missing from `eas credentials` output
     entirely, or (b) its Roles row shows less than `ADMIN` / `App Manager`.

The Discord ping fired by the `notify` job carries a parsed reason + recovery for the
matched failure mode (PP missing capability, cert not validated, ASC key missing,
runtime-version drift, EAS timeout). Read the ping before chasing the runbook — it
usually names the right section already.

## Runtime-version policy: `appVersion` (not `fingerprint`)

Runtime version = `app.json` `version`. **You MUST bump `version` in the same PR that
adds a native module or changes a config plugin.** Enforced by the `Runtime version
guard` workflow (`.github/workflows/runtime-version-guard.yml`) — it fails a PR with a
new iOS `@expo/fingerprint` (no prior `ios-fp-<hash>` tag) or changed app.json iOS
native fields unless `apps/workshop/app.json` `version` is bumped. When in doubt, bump.

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

You added an entitlement, associated domain, app group, etc. and the cached PP doesn't
carry it. Build fails with `Provisioning profile "..." doesn't include the X capability`
or `doesn't include the com.apple.developer.X entitlement`.

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# production → Build Credentials → Provisioning Profile → Delete one → confirm
```

Then force a fresh build. EAS regenerates the PP via the ASC API key with current
capabilities. **This works only if the distribution cert in EAS was minted via the API
key** (it is, post-2026-05-22). If the cert is older / interactively-minted, the
PP-only delete sends the next build into the cert-not-validated failure below — do the
cert-delete recovery instead.

### Distribution certificate out of sync

Build fails with `Distribution Certificate is not validated for non-interactive builds`,
followed by either `Failed to display prompt: Select your Apple Team Type` or
`Credentials are not set up. Run this command again in interactive mode`.

The cert in EAS was minted interactively pre-ASC-API-key, or got into a state the API
key can't validate. **The ASC API key alone can't auto-generate a fresh cert
non-interactively on an Individual Apple Developer account** — eas-cli needs to be told
Individual vs Company, which the API key doesn't expose. Delete-and-re-fire alone won't
recover; you have to mint the new cert in an interactive local session:

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# Log in with Apple ID when prompted (resolves Individual vs Company)
# production → Build Credentials → Distribution Certificate → Delete one
#   When prompted, also revoke at Apple Developer Portal → yes
# Back at the menu → Build Credentials → All: Set up all credentials to build your project
# Let EAS generate a fresh Distribution Certificate + Provisioning Profiles for
#   both Workshopdev and WorkshopShare targets
```

Both targets should show populated cert + PP rows when done. Force a fresh build. The
new cert is API-key-readable, so future capability toggles only need the PP-delete
recovery above. Currently-installed TestFlight builds keep working (signed at build
time, don't recheck).

### ASC submit queue stuck (IPA fine, downstream broken)

Download IPA from EAS dashboard, upload directly:

```bash
read -s "ASP?Paste app-specific password: " && echo "" && \
  xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa \
    -u joshlebed@gmail.com -p "$ASP" && unset ASP
```

App-specific password: <https://appleid.apple.com> → Sign-In and Security. macOS only.

### ASC API key missing or revoked

Build red at the `Write ASC API key` step, or `eas credentials` shows no
`App Store Connect API Key` row, or the key's Roles row isn't `ADMIN` / `App Manager`:

```bash
pnpm setup:asc-key
```

Interactive script — generates the key in the browser, encodes the `.p8`, pushes the
three GH secrets (`ASC_API_KEY_CONTENT`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`) via
`gh secret set`, and re-fires `testflight.yml --field force=true`. With the secrets in
place eas-cli auto-generates the cert + provisioning profile for any new bundle id
(share / widget / push extension) on the next build with zero human-in-loop.
Idempotent — run again to rotate. **Note:** this does NOT fix
`Distribution Certificate is not validated for non-interactive builds` — that's a
stale-cert problem, not a key problem. See "Distribution certificate out of sync" above.

A red `testflight.yml` run also pings `#workshop-admin` on Discord via the `notify`
job (uses `DISCORD_NOTIFY_WEBHOOK_URL` secret; missing webhook degrades to a CI
warning). The `Diagnose failure` step pattern-matches the eas-cli stderr against known
modes and emits a specific reason + recovery into the ping. If you see a `Build +
auto-submit` failure that the diagnose step labels "unrecognised eas-cli failure", add
a pattern to `.github/workflows/testflight.yml`'s `Diagnose failure` step in the same
PR that fixes the underlying issue.

## Monthly canary

`testflight.yml` runs a forced canary build on the 1st of each month at 14:00 UTC.
Personal-project cadence is ~5 native builds/month with quiet stretches; credential rot
(cert expiry, ASC key role drift, EAS signing-bot infra changes) tends to surface only
when a feature actually needs to ship. The canary takes ~1 EAS build minute and gives
the credential path a forced exercise. On failure it opens a tracked `infra-drift` GH
issue (in addition to the Discord ping) so the next deploy isn't the first thing that
finds the problem. Successful canary runs are silent — ignore the green checkmark.

## PR-time iOS capabilities guard

`.github/workflows/ios-capabilities-guard.yml` posts a sticky PR comment whenever
`apps/workshop/app.json` changes any iOS capability field (`associatedDomains`,
`entitlements`, `usesAppleSignIn`, `infoPlist.CFBundleURLTypes`, `bundleIdentifier`, or
the `expo-share-intent` / `expo-apple-authentication` / `expo-notifications` plugin
configs). The comment reminds the operator to delete the provisioning profile in EAS
before / after merge, so the next TestFlight build doesn't fail at the credentials step.
Heads-up only, not a required check. If you add a new capability-relevant field, add it
to the workflow's `FIELDS` jq expression.

## GitHub Actions concurrency

`testflight.yml` uses `concurrency: testflight, cancel-in-progress: false`. Right
default — don't abandon EAS minutes for a new push. But if the in-flight run is stuck,
new runs queue behind it. Cancel with `gh run cancel <run-id>`; the EAS build keeps
running on EAS's servers.
