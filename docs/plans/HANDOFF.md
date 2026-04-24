# Phase 0c handoff — portal config, Terraform apply, Cloudflare Pages, OAuth SDKs

Status: in progress · Opened: 2026-04-24 · Owner: @joshlebed

This file tracks the work that Phase 0c-1 (infra code changes, this PR) intentionally did
not do because it requires external-account access. Anyone picking up 0c-2 starts here.

The order matters: **portals → SSM → Terraform apply → Cloudflare Pages → client SDK
wiring**. Earlier steps unblock later ones.

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
