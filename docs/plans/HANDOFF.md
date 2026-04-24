# Phase 0c handoff — portal config, Terraform apply, Cloudflare Pages, OAuth SDKs

Status: in progress · Opened: 2026-04-24 · Owner: @joshlebed

This file tracks the work that Phase 0c-1 (infra code changes, this PR) intentionally did
not do because it requires external-account access. Anyone picking up 0c-2 starts here.

The order matters: **CI/CD unblock → portals → SSM → Terraform apply → Cloudflare Pages →
client SDK wiring**. Earlier steps unblock later ones.

---

## 0. CI/CD unblock (run this first — blocks every deploy)

All three deploy pipelines have been failing since Phase 0a landed on 2026-04-24. None of
the redesign is in production. Merging more redesign work without doing §0.1 first just
stacks up unshipped code.

### 0.1 Backend deploy — baseline the drizzle migration journal (manual, one-off)

**Symptom**: `Deploy Backend` workflow fails at `Run DB migrations` with
`relation "magic_tokens" already exists`.

**Root cause**: The production Neon database has the v1 schema but
`drizzle.__drizzle_migrations` is missing. On each deploy drizzle re-reads the journal
from scratch and tries to re-apply `0000_initial_schema`.

**Fix (admin, one-time)**:

1. Pull the prod connection string (if you don't already have it):

    ```bash
    AWS_PROFILE=workshop-prod aws ssm get-parameter \
      --name /workshop/database_url \
      --with-decryption --query 'Parameter.Value' --output text
    ```

    Or use the repo helper:

    ```bash
    AWS_PROFILE=workshop-prod ./scripts/db-connect.sh
    ```

2. Run the backfill SQL against prod. **Review it first** — it creates the `drizzle`
   schema and inserts exactly one row:

    ```bash
    AWS_PROFILE=workshop-prod psql "$DATABASE_URL" \
      -f apps/backend/scripts/2026-04-24-baseline-drizzle-migrations.sql
    ```

    Expected output: a single row with
    `hash = 210fa360a1e6defb5856138ff724c8842761ed2cb1f0ba935e49406b80f62858`
    and `created_at = 1776966724611`. The hash and timestamp are pinned to the
    on-disk inputs drizzle hashes at runtime — do not edit them.

3. Re-run the failed `Deploy Backend` workflow. On the next run drizzle will skip
    0000, apply `0001_drop_v1_schema` (drops v1 tables — irreversible, see §0.1-risks),
    then apply `0002_v2_schema`.

4. Verify:

    ```bash
    curl -fsS $(cd infra && AWS_PROFILE=workshop-prod terraform output -raw api_url)/health
    # expect: { "ok": true }
    AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 5m --filter error
    # expect: silent
    ```

**§0.1 risks**:

- `0001_drop_v1_schema` drops the `users`, `magic_tokens`, and `rec_items` tables with
  `CASCADE`. Any v1 user data is gone. That's the intended outcome of the redesign
  (spec §1, "Starting state") — v1 accounts are being thrown away and v2 rebuilds from
  OAuth sign-ins — but **snapshot the DB in Neon first** before running step 2 so there's
  a restore point. Neon: *Branch → Create branch from current state* on the prod branch.
- If the backfill row already exists (script is idempotent), the script is a no-op and
  safe to re-run.

### 0.2 Mobile (OTA) + TestFlight — RN pinned back to Expo SDK 55 (code, in this PR)

**Symptom**: `Deploy Mobile (OTA)` and `TestFlight` workflows fail at
`Publish EAS Update` / `EAS Build` with:

```
SyntaxError: ../../node_modules/react-native/src/private/components/virtualview/
  VirtualViewExperimentalNativeComponent.js: Unable to determine event arguments
  for "onModeChange"
```

**Root cause**: Dependabot (#?) bumped `react-native` 0.83.6 → 0.85.2 and satellites
past the versions Expo SDK 55 supports. RN 0.85's new `VirtualViewExperimentalNativeComponent`
declares a nested `DirectEventHandler` type that the Expo-bundled
`@react-native/babel-plugin-codegen` (older) can't parse. The CLAUDE.md rule was
"run `npx expo install --check` before upgrading mobile deps"; Dependabot ran without
that gate.

**Fix (in this PR)**:

- `apps/workshop/package.json` — `react-native` / `react-native-gesture-handler` /
  `react-native-reanimated` / `react-native-safe-area-context` / `react-native-screens`
  / `react-native-worklets` / `react` / `react-dom` pinned back to the exact versions
  reported by `pnpm exec expo install --check`.
- `.github/dependabot.yml` — added `ignore` entries (minor + major) for each RN
  satellite. Re-open these when bumping Expo SDK itself.

**Admin follow-up**:

- After this PR merges, re-run the failed `Deploy Mobile (OTA)` and
  `TestFlight (native iOS build)` workflows. The EAS Update should publish within ~60s;
  TestFlight only rebuilds if `@expo/fingerprint` sees a native change (it will — RN is
  pinned back). Expect an auto-submit to App Store Connect.
- Close any open Dependabot PRs that bump RN past 0.83.6 — the new `ignore` will keep
  future ones from opening until the SDK itself moves.

---

## 1. What 0c-1 actually landed

Purely code, no cloud actions:

- `infra/ses.tf` deleted; `ses_verified_email` variable removed from
  `infra/variables.tf`; `terraform.tfvars.example` no longer lists it.
- `SES_FROM_ADDRESS` env var removed from `aws_lambda_function.api` in
  `infra/lambda.tf` and from the CI migrate job in
  `.github/workflows/deploy-backend.yml`.
- SES IAM policy statement (`aws_iam_role_policy.lambda_inline`, `ses:SendEmail` /
  `ses:SendRawEmail`) removed from `infra/lambda.tf`. `aws_iam_role_policy_attachment.lambda_basic`
  (AWSLambdaBasicExecutionRole) is the only remaining policy — enough for CloudWatch Logs.
- Six new `aws_ssm_parameter` resources added in `infra/ssm.tf`: `apple_bundle_id`,
  `apple_services_id`, `google_ios_client_id`, `google_web_client_id`, `tmdb_api_key`,
  `google_books_api_key`. All `SecureString`, all default to empty, all
  `lifecycle { ignore_changes = [value] }` so ops can rotate them in-place via the AWS
  CLI without Terraform fighting the change.
- Matching variables in `infra/variables.tf` (all default `""`) and placeholders in
  `infra/terraform.tfvars.example`.
- `aws_lambda_function.api` now passes six new env vars: `APPLE_BUNDLE_ID`,
  `APPLE_SERVICES_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID`, `TMDB_API_KEY`,
  `GOOGLE_BOOKS_API_KEY`. Values are read from SSM at apply time.

Nothing was applied. `terraform plan` will show the SES identity + IAM policy + env var
removal, and the six SSM params created with empty values.

---

## 2. Apple Developer portal (blocks Apple sign-in)

Required:

- [ ] Confirm Apple Developer enrollment (Team ID `Q65U6C65ZZ`).
- [ ] On the App ID for `dev.josh.workshop`: enable the **Sign in with Apple** capability.
- [ ] Create a **Services ID** for the web flow. Suggested identifier:
      `dev.josh.workshop.web`. This identifier becomes the `aud` claim on web identity
      tokens and must be pasted into SSM as `apple_services_id`.
- [ ] On that Services ID, configure **Return URLs**. For Phase 0c:
    - `http://localhost:8081` (Expo web dev)
    - `https://workshop.pages.dev` (temporary Cloudflare Pages URL; add the custom
      domain later when it lands)
- [ ] Create a **Sign in with Apple key** (`.p8`). Not strictly required for the
      identity-token verification path the backend uses, but keep the key and Key ID
      in 1Password in case we later need to issue our own Apple client secrets.

Outputs to paste into SSM:
- `apple_bundle_id` → `dev.josh.workshop`
- `apple_services_id` → `dev.josh.workshop.web`

---

## 3. Google Cloud Console (blocks Google sign-in)

Required:

- [ ] Project `workshop` under the same Google account as the domain.
- [ ] **OAuth consent screen** configured (External type is fine for solo use; App name
      "Workshop.dev"). Scopes: `openid email profile`.
- [ ] **Create OAuth client ID → iOS**. Bundle ID `dev.josh.workshop`. Copy the client
      ID — it is the `aud` for native Google tokens.
- [ ] **Create OAuth client ID → Web application**. Authorized JavaScript origins:
      `http://localhost:8081`, `https://workshop.pages.dev`. Authorized redirect URIs
      (only if using the implicit flow; Google Identity Services doesn't require one).
      Copy the client ID — it is the `aud` for web Google tokens.

Outputs to paste into SSM:
- `google_ios_client_id` → `<ios-client-id>.apps.googleusercontent.com`
- `google_web_client_id` → `<web-client-id>.apps.googleusercontent.com`

---

## 4. Enrichment API keys (Phase 2, can be deferred until Phase 2 starts)

- [ ] TMDB API key — free tier; request at <https://www.themoviedb.org/settings/api>.
- [ ] Google Books API key — create under the same Google Cloud project (Phase 0c §3);
      enable the **Books API** service first.

Outputs to paste into SSM:
- `tmdb_api_key` → `<v3 auth API key>` (not the v4 Read Access Token)
- `google_books_api_key` → `<api key>`

These can stay empty through 0c-2 — nothing in Phases 0/1 depends on them.

---

## 5. SSM paste + Terraform apply

Once §2–§3 are done (§4 optional):

```bash
aws sso login --profile workshop-prod

cd infra
AWS_PROFILE=workshop-prod terraform init
AWS_PROFILE=workshop-prod terraform plan    # should show ses.tf deletion + 6 SSM params created empty
AWS_PROFILE=workshop-prod terraform apply
```

Then paste the real values via `aws ssm put-parameter --overwrite` (the SSM resources
have `ignore_changes = [value]` so this won't drift state):

```bash
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop/apple_bundle_id      --type SecureString --overwrite --value 'dev.josh.workshop'
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop/apple_services_id    --type SecureString --overwrite --value 'dev.josh.workshop.web'
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop/google_ios_client_id --type SecureString --overwrite --value '<from §3>'
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop/google_web_client_id --type SecureString --overwrite --value '<from §3>'
```

Bounce the Lambda so it picks up the new env var values — easiest way is to push a
no-op change to `apps/backend/` on `main`, which re-runs the deploy workflow. Or:

```bash
AWS_PROFILE=workshop-prod aws lambda update-function-configuration \
  --function-name workshop-api \
  --environment "Variables={...}"   # pull the current env + new SSM values
```

Verify with:

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 5m --filter OAuthVerifyError
# should be silent; if populated, the client is passing a token whose `aud` doesn't match
```

---

## 6. Cloudflare Pages (blocks web production URL)

- [ ] Create Cloudflare account (free tier is sufficient).
- [ ] In the dashboard: **Workers & Pages** → **Create application** → **Pages** →
      **Connect to Git** → pick `joshlebed/workshop`.
- [ ] Project name: `workshop`. Production branch: `main`.
- [ ] Build config:
    - Build command: `pnpm install --frozen-lockfile && pnpm --filter workshop-app exec expo export --platform web`
    - Build output directory: `apps/workshop/dist`
    - Root directory: (repo root)
    - Node version: `20.19` (env var `NODE_VERSION`)
- [ ] Environment variables (Production):
    - `EXPO_PUBLIC_API_URL` → the Lambda's API Gateway URL from
      `terraform output -raw api_url`
    - `NODE_VERSION` → `20.19`
- [ ] First build runs automatically on push to `main`. URL lands at
      `https://workshop.pages.dev`.
- [ ] Once live, add that URL to Apple Services ID return URLs (§2) and Google OAuth
      authorized origins (§3), then re-paste updated SSM values if the audiences
      changed.

Note: nothing in Terraform — CF is out of band from AWS.

---

## 7. Client OAuth SDK wiring (the 0c-2 client PR)

This is the work that replaces the warning-dialog stubs in
`apps/workshop/app/sign-in.tsx`. Do NOT start until §2–§5 are done; without real
client IDs the buttons will fail silently.

Packages:

```bash
cd apps/workshop
pnpm add expo-apple-authentication expo-auth-session expo-crypto expo-web-browser
npx expo install --check     # pin to SDK-compatible versions
```

Wiring:

- `apps/workshop/app.json` — add `expo-apple-authentication` to the `plugins` array
  (it needs a config plugin to enable the iOS entitlement). Expo prebuild will pick
  it up when we eventually need a native build.
- `apps/workshop/src/hooks/useAuth.tsx`:
    - `signInWithApple` (iOS native): `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`,
      POST `{ identityToken, nonce, email, fullName }` to `/v1/auth/apple`.
    - `signInWithApple` (web): load Sign in with Apple JS, render the required styled
      button (an AppleJS constraint — Apple reviews the login UI), wire the
      `onSuccess` to POST the token. The `.web.tsx` split applies here; don't try
      to run `AppleAuthentication` on web.
    - `signInWithGoogle` (iOS): `expo-auth-session`'s `Google.useAuthRequest` with
      `iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Prompt returns an
      `idToken`; POST to `/v1/auth/google`.
    - `signInWithGoogle` (web): Google Identity Services' `google.accounts.id`
      button, same idea — yields an `idToken`, POST to `/v1/auth/google`.
- Add EXPO_PUBLIC_ env wiring:
    - `EXPO_PUBLIC_APPLE_SERVICES_ID`
    - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
    - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

  Set the web values via the Cloudflare Pages env (§6). Set the iOS values via the
  EAS Secret store if/when a native build is needed (deferred; Phase 4-ish).
- Delete the `window.alert` / `Alert.alert` warning dialogs in
  `apps/workshop/app/sign-in.tsx`. Keep the dev-auth button behind
  `EXPO_PUBLIC_DEV_AUTH === "1"`.
- Add a second Playwright happy-path that stubs Google Identity Services'
  response with a known-good JWT (keep the existing dev-auth path too — it remains
  the fast smoke test).

---

## 8. Known stale docs (don't block on these, but note them)

- `docs/manual-setup.md` still references SES and `apps/watchlist`. Rewrite when the
  OAuth migration has actually shipped end to end.
- `docs/new-app-playbook.md` is the generic new-app template; still describes the
  magic-link + SES pattern. Update once this redesign is settled and we know what
  the post-redesign template looks like.
