# Sentry setup

Wires error reporting + tracing across the three production surfaces:

- **Backend Lambda** (`@sentry/aws-serverless`): unhandled errors + handler-level traces.
- **iOS / web** (`@sentry/react-native`): JS crashes, native iOS crashes (symbolicated),
  navigation breadcrumbs, touch-event breadcrumbs.

The SDK is a no-op until a DSN is configured, so this PR is safe to merge before the admin
steps below — nothing breaks if Sentry isn't set up yet.

## Why Sentry

Free tier: 5k errors / 10k perf events / 50 replays per month. Enough for early beta.
Single vendor covers all three surfaces with one auth token, one source-map pipeline.

## Admin checklist (one-time, before first event flows)

### 1. Create Sentry org + projects

- Sign up at <https://sentry.io> — pick the **Developer** plan (free).
- Org slug: **`joshlebed`** (match `apps/workshop/app.json` plugin config; if you pick a
  different slug, update the plugin entry).
- Create two projects:
  - **`workshop-backend`** — platform: Node.js / AWS Lambda
  - **`workshop-mobile`** — platform: React Native (covers iOS + web bundle)
- Copy the **DSN** for each project (Settings → Client Keys (DSN)).

### 2. Backend DSN → SSM

```bash
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --region us-east-1 \
  --name /workshop-prod/sentry_dsn \
  --type SecureString \
  --value 'https://<key>@<org>.ingest.sentry.io/<project>' \
  --overwrite
```

Then redeploy the Lambda (push to `main` or
`gh workflow run deploy-backend.yml --ref main`) — the SDK reads `SENTRY_DSN` at cold start.

### 3. Mobile DSN + auth token → GitHub Actions secrets

Generate a Sentry **auth token** with `project:releases` and `org:read` scopes:
<https://sentry.io/orgredirect/organizations/:orgslug/settings/auth-tokens/>.

Add three secrets at <https://github.com/joshlebed/workshop/settings/secrets/actions>:

- `EXPO_PUBLIC_SENTRY_DSN` — the **mobile** project's DSN (read at JS bundle time, embedded
  in the app bundle; not actually secret since end users can read it from the app, but kept
  in GH secrets for parity with other config).
- `SENTRY_AUTH_TOKEN` — the auth token from above (used by the Sentry expo plugin to upload
  Hermes source maps for OTA updates).
- The above two are enough for the **OTA** path (`Deploy Mobile (OTA)` workflow).

### 4. Mobile DSN + auth token → EAS env (for native TestFlight builds)

The native iOS build runs on EAS infrastructure, not GitHub Actions, so EAS needs its own
copy of the env vars. Run from `apps/workshop/`:

```bash
npx eas-cli env:create production \
  --name EXPO_PUBLIC_SENTRY_DSN \
  --type plain \
  --visibility plain \
  --value 'https://<key>@<org>.ingest.sentry.io/<project>'

npx eas-cli env:create production \
  --name SENTRY_AUTH_TOKEN \
  --type secret \
  --visibility secret \
  --value '<auth_token>'
```

EAS injects these automatically into the next production build's environment — no
`eas.json` change needed.

### 5. Trigger fresh builds

Either push a no-op commit to `main`, or:

```bash
gh workflow run deploy-backend.yml --ref main
gh workflow run testflight.yml --ref main --field force=true
```

The OTA workflow fires on the next mobile-app push automatically.

## Verifying

- Backend: hit a test endpoint that throws (or wait for a real 5xx). Event appears in the
  `workshop-backend` project within ~30s.
- Mobile: trigger a JS exception in the app (e.g. dev menu → throw test error). Event
  appears in `workshop-mobile`. Source maps verified by clicking through the stack trace —
  you should see TypeScript filenames (`src/screens/...`), not minified `index.bundle:1:42`.

## Rotation

Auth token: revoke at the URL above, generate new, update in both GH Actions secrets and
EAS env (`eas env:update`).

DSN: regenerate in Sentry (Settings → Client Keys → rotate). Update SSM param + EAS env +
GH Actions secret.

## Cost guardrails

- Free-tier hard cap is 5k errors/month. Sample rate for traces is **10%** (set in
  `apps/backend/src/lib/sentry.ts` and `apps/workshop/src/lib/sentry.ts`); errors at 100%.
- If the error count spikes past free tier, Sentry stops accepting events for the rest of
  the month rather than billing — a safe failure mode for personal projects.
- Consider setting per-project **spike protection** in Sentry settings as defense in depth.
