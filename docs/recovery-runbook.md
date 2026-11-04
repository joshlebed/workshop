# Recovery runbook

Flat lookup table for "this thing is broken, what do I do?" Each entry is a symptom you'd
actually see, plus the fix path. Ordered by frequency we've hit them.

For deeper context on _why_ a system is shaped the way it is, see `docs/decisions.md`. For
day-to-day patterns, see `CLAUDE.md`.

---

## TestFlight / iOS

### Symptom: First EAS build says "Distribution Certificate is not validated" and "Credentials are not set up"

**Cause**: A new EAS project has no distribution certificate assigned. The ASC API key
authenticates CI, but eas-cli will not create or choose a missing certificate while
`--non-interactive` is set.

**Fix**:

```bash
cd apps/highscore && npx eas-cli@27.4.0 credentials --platform ios
# → production → Build Credentials → All
# → reuse the valid team certificate; create HighScore + HighScoreShare profiles
# → do NOT delete/revoke Workshop's certificate
gh workflow run testflight-highscore.yml --ref main --field force=true
```

### Symptom: TestFlight build fails with "Provisioning profile doesn't include the X capability"

**Cause**: A capability got added/removed on the App ID in the Apple Developer Portal, which
invalidates existing provisioning profiles. EAS sometimes detects this and regenerates,
sometimes doesn't (cached profile reference).

**Fix**:

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# → production
# → Build Credentials: Manage everything needed to build your project
# → Provisioning Profile: Delete one from your project
# → confirm
```

Then trigger a fresh build:

```bash
gh workflow run testflight.yml --ref main --field force=true
```

EAS sees no valid profile, regenerates with the current capabilities. Build proceeds.

### Symptom: EAS Build succeeded but Submit failed with "Failed to create worker instance" or hangs 10+ min

**Cause**: EAS free-tier submission worker pool is congested. Apple-side (App Store Connect)
might also be flaky.

**Fix path A — retry only the submit job** (preferred — no rebuild):

```bash
gh run rerun --failed <run-id>
```

This re-runs _only_ the failed `submit` job against the existing IPA. The `testflight.yml`
split (since 2026-04-27) makes this work. Internal retry loop in the submit job gives 3×
attempts with 60s backoff before giving up.

**Fix path B — bypass EAS submit entirely via `xcrun altool`** (if EAS queue is just stuck
indefinitely):

```bash
# 1. Download the IPA from the EAS build details page
#    https://expo.dev/accounts/joshlebed/projects/workshop/builds → click latest finished build → Download

# 2. Generate an app-specific password at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords

# 3. Upload via altool (ships with Xcode)
read -s "ASP?Paste app-specific password: " && echo "" && \
  xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa \
    -u joshlebed@gmail.com -p "$ASP" && unset ASP
```

Upload takes ~2 min; appears in App Store Connect → TestFlight → iOS Builds within ~10 min.

### Symptom: Build fails with "ASC API key required in non-interactive mode"

**Cause**: The EAS-managed App Store Connect API key was set up for `submit` only and isn't
registered for `build`-side credential operations (regenerating provisioning profiles in CI).

**Fix**:

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# → production → App Store Connect: Manage your API Key
# → Set up an App Store Connect API Key for your project
# → reuse the existing ADMIN-role key, or create a new one in App Store Connect
```

See `docs/manual-setup.md` §5 for the full runbook.

### Symptom: Apple Developer Portal API returns 5xx during `eas credentials`

**Cause**: Apple's portal has occasional outages. EAS retries 3× with 3s backoff (~9s total)
and then fails.

**Fix**: Wait 5-10 minutes, retry the same `eas credentials` command. Recovery is usually
quick. Apple doesn't have a machine-readable status; the outage is transparent.

### Symptom: TestFlight build fails with "This account has used its iOS builds from the Free plan this month"

**Cause**: EAS Free plan quota exhausted. Each fingerprint change is one iOS build per app;
2026-11-03 spent the month's allowance on pipeline iterations, JS-only fingerprint moves
(`package.json` `scripts`, `eas.json` `cli.version` — both excluded from the hash since) and
duplicate builds of one fingerprint (fixed by the build job's tag re-check).

**Fix**: Nothing in the repo. JS keeps shipping by OTA. Wait for the reset (1st of the month)
or upgrade (`eas billing:subscribe starter --account joshlebed`, operator decision), then:

```bash
gh workflow run testflight-highscore.yml --ref main --field force=true   # or testflight.yml
```

Before that, check whether the pending native change actually needs a binary: compare the
fingerprint sources (`CLAUDE.md` → "EAS builds are metered").

### Symptom: TestFlight workflow run is stuck `in_progress` for 30+ min

**Cause**: Usually not stuck. On the Free plan an iOS build waits 30–50 min in EAS's queue
before it starts, then ~15 min to build, then `eas submit --wait` waits for Apple; ~1h total
is normal (the job allows 150 min). The build job's `cancel-in-progress: false` concurrency
group blocks new pushes from preempting it — on purpose.

**Fix**: Wait. If the EAS dashboard shows the build finished long ago and the submission is
queued indefinitely:

```bash
gh run cancel <run-id>
```

This frees the GitHub Actions runner and the concurrency lock; queued runs proceed. The
fingerprint tag was written when the build finished, so the next push does not rebuild; the
binary can be re-submitted with `eas submit --platform ios --profile production --id <build-id>`
from the app directory.

If you also want to clear the queued submissions, cancel them in the EAS dashboard
(submissions page → "Cancel").

### Symptom: TestFlight build fingerprint check skips when it shouldn't

**Cause**: The `ios-fp-<hash>` git tag for the current fingerprint already exists. `testflight.yml`
treats this as "already built, no work needed" and exits.

**Fix**: Force a build via workflow_dispatch:

```bash
gh workflow run testflight.yml --ref main --field force=true
```

If you also want to delete the stale tag (rare; usually leave it):

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
```

---

## Backend / Lambda

### Symptom: Lambda env var seems wrong even after `aws ssm put-parameter`

**Cause**: Lambda env vars are baked at `terraform apply` time, not at SSM-update time.
Updating an SSM parameter directly doesn't propagate to running Lambda containers — you have
to refresh the function configuration.

**Fix**:

```bash
cd infra && AWS_PROFILE=workshop-prod terraform apply
```

Terraform reads the live SSM values and re-applies the Lambda function configuration with
them. Brief sub-second blip on in-flight requests; existing connections are killed.

Verify with:

```bash
AWS_PROFILE=workshop-prod aws lambda get-function-configuration \
  --function-name workshop-prod-api --query 'Environment.Variables'
```

### Symptom: Lambda /health returns 503 or 5xx after deploy

**Cause**: Migration job didn't finish before the Lambda code went live; or a Drizzle
migration is partially applied.

**Fix**: Check the deploy workflow's `migrate` job logs first. If migrations partially
applied, see the prod-DB recovery section in `docs/plans/HANDOFF.md` (or its archived
postmortem in `docs/decisions.md`).

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh
# psql> select * from drizzle.__drizzle_migrations order by created_at;
```

### Symptom: HCP Terraform apply hangs or fails with "Error acquiring the state lock"

**Cause**: A previous `terraform apply` was killed (Ctrl-C, CI cancel, runner crash); the
state lock didn't auto-release.

**Fix**: Open <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>,
click **Unlock** (top right), retry. Prefer this over `-lock=false` — the flag bypasses
safety; UI unlock clears cleanly.

---

## CI / GitHub Actions

### Symptom: `dorny/paths-filter` job fails with "Resource not accessible by integration"

**Cause**: The `permissions:` block on the workflow doesn't grant `pull-requests: read`.
By default workflows only have `contents: read` on PR events; `paths-filter` needs to
enumerate PR commits.

**Fix**: Add to the relevant job:

```yaml
permissions:
  contents: read
  pull-requests: read
```

### Symptom: `gh pr merge --auto` fails with "Auto merge is not allowed for this repository"

**Cause**: Auto-merge requires GitHub branch protection. On a private repo on the free
GitHub plan, branch protection isn't available, so auto-merge is locked out.

**Fix**: Either make the repo public (free, but exposes code) or upgrade to GitHub Pro
($4/mo). The `/continue-redesign` skill falls back to manual merge cleanly without either —
no urgency.

### Symptom: A docs-only PR is running 8 jobs in CI

**Cause**: Lifecycle issue — the path-filter changes from PR #65 didn't land yet, or the
filter scope doesn't match the diff.

**Fix**: Check that `.github/workflows/ci.yml` has the `changes` job with the appropriate
filter outputs gating the heavy jobs. If filters look right but a job ran anyway, look at
the job's `if:` condition — `github.event_name == 'push'` runs on push to main regardless
of filters.

---

## Web / Cloudflare Pages

### Symptom: Web sign-in fails with "Invalid audience" / 401 from Lambda

**Cause**: The CF Pages env vars don't match the SSM values the Lambda is using. Most
common after rotating an OAuth client ID and forgetting to update CF Pages.

**Fix**: Cross-check the audience values:

```bash
# Lambda side (from SSM)
AWS_PROFILE=workshop-prod aws lambda get-function-configuration \
  --function-name workshop-prod-api \
  --query 'Environment.Variables.{APPLE:APPLE_SERVICES_ID,GIOS:GOOGLE_IOS_CLIENT_ID,GWEB:GOOGLE_WEB_CLIENT_ID}'

# Web side: Cloudflare dashboard → Pages → workshop → Settings → Variables and Secrets
```

If they differ, follow the rotation playbook in `docs/manual-setup.md` §10.1.

### Symptom: Cloudflare Pages preview check on a PR shows "pass 0s"

**Not actually broken** — CF detected the changes as web-build-irrelevant (e.g. md-only,
.claude-only) and marked the check pass without rebuilding. Treat as informational.

---

## Local dev

### Symptom: `pnpm dev` fails because Postgres container doesn't start

**Cause**: Docker Desktop isn't running, or port 5432 is already taken.

**Fix**:

```bash
# Verify Docker
docker ps

# Check port
lsof -ti:5432

# Kill anything holding 5432
lsof -ti:5432 | xargs kill 2>/dev/null

# Restart
pnpm dev
```

### Symptom: Niteshift sandbox web preview returns 403 on POST/PATCH/DELETE

**Cause**: The Niteshift preview proxy rejects unauthenticated CORS preflights from
mismatched origins.

**Fix**: This is handled by `packages/api-client/src/config.ts` — it derives the API URL from
`window.location` on web so the origin matches. If you've broken that derivation, restore
the `ns-<port>-<id>` rewrite logic. See `CLAUDE.md` "Known sandbox gotcha".

---

## When this runbook can be deleted

When all entries above either:

1. Have happened so rarely (less than 1×/year) that the cost of keeping the entry exceeds the
   savings from the entry, or
2. Have been refactored out by code/infra changes (e.g. the EAS submission queue contention
   stops being an issue if we move to a paid tier).

Until then, leave it in place and add new entries as new symptom classes appear. The
threshold for adding a new entry: "I'd kick myself if a future agent re-derived this fix path
from scratch." Each entry should save a future agent at least 15 minutes of triage.
