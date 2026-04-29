# Manual setup

Ordered checklist of external-account setup and one-time configuration needed before the first
green deploy. Work through it top to bottom — each step depends on the ones above.

## 1. AWS account

- [ ] Create IAM user for your laptop (not root) with "PowerUserAccess" or broader. This is for
      your local `terraform apply` and ad-hoc AWS CLI work.
- [ ] `aws configure` → paste access key, secret, region `us-east-1`.
- [ ] `aws sts get-caller-identity` — confirm you're the expected account.
- [ ] Enable **AWS Budgets** via console if it isn't already. (Terraform `aws_budgets_budget`
      doesn't auto-enable the service.)

## 2. HCP Terraform (state backend)

- [ ] Sign up at <https://app.terraform.io> (GitHub login is fine).
- [ ] Create organization **`joshlebed`** (matches `infra/versions.tf`). If you use a different
      org name, update `versions.tf` accordingly.
- [ ] Inside the org, create workspace **`workshop-prod`**, "CLI-driven" workflow.
- [ ] In the workspace's Variables tab, add these as **Terraform variables** (not env):
  - `ses_verified_email` — the email that SES will verify as sender (e.g. `joshlebed@gmail.com`)
  - `budget_email_recipient` — usually the same
- [ ] Add as **Environment variables**, marked sensitive:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - (Create an IAM user "terraform-cloud" with PowerUserAccess for this)
- [ ] On your laptop: `terraform login` — browser opens, paste the token.

## 3. First `terraform apply`

```bash
cd infra
terraform init      # connects to HCP
terraform apply
```

After the first apply:

- [ ] **Check your email for an AWS SES verification link** (sender: no-reply-aws@amazon.com)
      and click it. Until this is done, the Lambda can't send magic codes.
- [ ] **Check your email for a budget subscription confirmation** and click it.
- [ ] Copy the outputs: `api_url`, `github_actions_role_arn`, `lambda_function_name`. You'll need
      these in step 5.

## 4. SES sandbox → production access (optional for MVP)

In SES sandbox mode, you can only send mail to _verified_ addresses. So for solo dev:

- [ ] Your own email is already verified (it's the `ses_verified_email`).
- [ ] To test with friends: verify each friend's email manually in the SES console ("Verified
      identities" → "Create identity" → Email address).
- [ ] Or request production access: SES console → Account dashboard → "Request production access."
      This is a manual AWS ticket, typically approved in 24–48h. Only do this when you're about to
      share the app.

## 5. Apple Developer + EAS

- [ ] Confirm you're enrolled at <https://developer.apple.com/account>.
- [ ] Grab your **Apple Team ID** (top-right in Apple Developer console) and **App Store Connect
      App ID** (create a new app at <https://appstoreconnect.apple.com>; bundle ID:
      `dev.josh.workshop`).
- [ ] Sign up at <https://expo.dev> (free tier).
- [ ] `npx eas-cli@latest login` — paste Expo credentials.
- [ ] `cd apps/watchlist && npx eas-cli@latest init` — creates an EAS project and prints the
      project ID.
- [ ] Replace **both** instances of `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` with the real ID.
- [ ] Replace `REPLACE_WITH_APPSTORE_CONNECT_APP_ID` and `REPLACE_WITH_APPLE_TEAM_ID` in
      `eas.json`.
- [ ] `npx eas-cli@latest credentials` — interactively generate push certs + provisioning profile.
      EAS manages these going forward.
- [ ] **Register an App Store Connect API key with EAS Build for non-interactive credential ops.**
      EAS sets up an ASC API key automatically for the _submit_ step (`[Expo] EAS Submit ...`),
      but the _build_ step needs its own registration so it can regenerate provisioning profiles
      in CI without prompting for Apple credentials. Without this, any future capability change
      on the App ID (e.g. enabling Sign In with Apple, App Groups, Push Notifications) breaks
      `testflight.yml` until someone runs `eas credentials` interactively from a laptop with an
      active Apple session.

      Setup:
        1. Open `eas credentials --platform ios` (CWD: `apps/workshop`), pick `production`.
        2. Pick **`App Store Connect: Manage your API Key`** → **Set up an App Store Connect API Key for your project**.
        3. Either reuse the existing `[Expo] EAS Submit` key (it has the ADMIN role, which is
           sufficient) or create a new one at
           <https://appstoreconnect.apple.com/access/api> with role **App Manager** or higher.
        4. Confirm. Key is stored on EAS's servers — nothing to commit.

      Verify with: trigger `gh workflow run testflight.yml --ref main --field force=true`
      after a capability change. The build should auto-regenerate the profile without asking
      for Apple auth.

- [ ] Create an **Expo access token** at <https://expo.dev/settings/access-tokens> (for CI).

## 6. GitHub repo + secrets

- [ ] `gh repo create joshlebed/workshop --public --source . --push` (this repo does step 9 for
      you).
- [ ] In repo settings → **Secrets and variables → Actions**, add:
  - `AWS_ROLE_ARN` — value from the `github_actions_role_arn` Terraform output
  - `TF_API_TOKEN` — an HCP Terraform user API token
    (<https://app.terraform.io/app/settings/tokens>)
  - `EXPO_TOKEN` — the Expo access token from step 5
  - `EXPO_PUBLIC_API_URL` — value from the `api_url` Terraform output (e.g.
    `https://abc123.execute-api.us-east-1.amazonaws.com`)

## 7. Branch protection

In repo settings → **Branches** → Branch protection rules → Add rule for `main`:

- [ ] Require status checks to pass: `lint-typecheck-test`, `terraform-check`
- [ ] Require pull request before merging (1 approval if you're solo, optional)
- [ ] Do **not** require signed commits (friction for casual contributors)

## 8. First deploy

- [ ] Push to main. `deploy-backend.yml` runs → terraform → migrate → bundle → upload → smoke test
      `/health`.
- [ ] `deploy-mobile.yml` runs → EAS Update → your phone picks it up next Expo Go launch.

## 9. Paired phone

- [ ] Install Expo Go on your iPhone.
- [ ] `cd apps/watchlist && pnpm start` — scan QR with Camera app.
- [ ] Sign in with your verified email. 6-digit code arrives via SES.
- [ ] Add a movie. Success.

## 10. Rotation playbooks

The values below are scattered across multiple systems by design (each system is the source of
truth for its slice — see `CLAUDE.md` "Sources of truth"). Rotation means updating _each_
location. Easy to forget one, so use these checklists.

### 10.1 Apple/Google OAuth client ID rotation

If you regenerate the Apple Services ID, the Google iOS OAuth client, or the Google web OAuth
client (typical reasons: portal cleanup, security incident, switching accounts), the new
client ID has to be propagated to **six** places. Lambda + web bundle reject auth with the
old audience until all six are in sync.

1. **AWS SSM** — Lambda reads from here:
   ```bash
   AWS_PROFILE=workshop-prod aws ssm put-parameter \
     --name /workshop-prod/<apple_services_id|google_ios_client_id|google_web_client_id> \
     --type SecureString --overwrite --value '<new value>'
   ```
2. **Bounce the Lambda** so the new env value takes effect:
   ```bash
   cd infra && AWS_PROFILE=workshop-prod terraform apply
   ```
   (Re-applies with the same SSM-resolved values; Lambda env vars get refreshed.)
3. **Cloudflare Pages env vars** — web bundle reads from here at build time. Dashboard →
   Pages → workshop → Settings → Variables and Secrets → edit
   `EXPO_PUBLIC_APPLE_SERVICES_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` /
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Trigger a redeploy from the dashboard or push a no-op
   commit to refresh.
4. **`apps/workshop/eas.json`** — iOS native build reads from here:
   `build.production.env` has the same three vars. Edit and commit.
5. **`apps/workshop/app.json`** — only the **iOS Google client ID** matters here, in
   `ios.infoPlist.CFBundleURLTypes` as the reverse scheme
   (`com.googleusercontent.apps.<iOS-client-suffix>`). Edit and commit.
6. **`.github/workflows/{deploy-mobile,testflight}.yml`** — both inject the three vars at
   the EAS Update / EAS Build step. Edit and commit.

Once the commit lands on `main`, `Deploy Mobile (OTA)` ships the new audience to existing
TestFlight users via EAS Update; `TestFlight (native iOS build)` rebuilds (because the
fingerprint changed) only if app.json is in the diff.

Verify with:

```bash
AWS_PROFILE=workshop-prod aws lambda get-function-configuration --function-name workshop-prod-api \
  --query 'Environment.Variables.{APPLE:APPLE_SERVICES_ID,GIOS:GOOGLE_IOS_CLIENT_ID,GWEB:GOOGLE_WEB_CLIENT_ID}'
```

### 10.2 TMDB / Google Books API key rotation

Simpler than OAuth — only one location:

```bash
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop-prod/<tmdb_api_key|google_books_api_key> \
  --type SecureString --overwrite --value '<new value>'

cd infra && AWS_PROFILE=workshop-prod terraform apply  # bounces Lambda
```

The keys live only in Lambda env (no client-side use), so no EAS / CF Pages / workflow
updates needed.

### 10.3 ASC API key rotation

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# → production → App Store Connect: Manage your API Key
# → "Remove App Store Connect API Key" then "Set up an App Store Connect API Key"
```

Generate the new key in App Store Connect (<https://appstoreconnect.apple.com/access/api>)
with role **App Manager** or higher; download the `.p8` once at creation time (Apple won't
re-show it), paste into the eas-cli prompt. EAS stores it server-side; nothing to commit.

### 10.4 Database connection string rotation

**Careful** (see `CLAUDE.md` Safe vs careful changes). In-flight requests may briefly fail.

```bash
AWS_PROFILE=workshop-prod aws ssm put-parameter \
  --name /workshop-prod/db/url \
  --type SecureString --overwrite --value '<new connection string>'

cd infra && AWS_PROFILE=workshop-prod terraform apply  # Lambda env updates
```

Verify with `curl /health` and `./scripts/logs.sh --since 5m --filter error`.

## 11. Adding an iOS capability

When adding a capability to the App ID — App Groups, Push Notifications, Associated Domains,
HealthKit, etc. — follow this order. Skipping a step usually leaves the app unable to build
or use the capability at runtime.

1. **Declare in code first.** Either:
   - In `apps/workshop/app.json` `ios.entitlements`:
     ```json
     "entitlements": {
       "com.apple.security.application-groups": ["group.dev.josh.workshop"]
     }
     ```
   - Or via an Expo config plugin (e.g. `expo-apple-authentication` enables Sign In with Apple
     this way). Plugin in `app.json` `expo.plugins` array.
2. **Enable the matching capability in the Apple Developer Portal** (<https://developer.apple.com/account/resources/identifiers/list>):
   - App ID → Edit → check the capability checkbox → Configure if needed → Save modal → Save
     top-right of App ID page → Confirm "Modify App Capabilities" warning.
3. **Regenerate the provisioning profile** (Apple invalidates existing ones on capability
   changes):
   ```bash
   cd apps/workshop && npx eas-cli@latest credentials --platform ios
   # → production → Build Credentials → Provisioning Profile: Delete one from your project
   ```
4. **Trigger a fresh TestFlight build**:
   ```bash
   gh workflow run testflight.yml --ref main --field force=true
   ```
5. **Verify** on the next TestFlight build — should not fail with
   `"Provisioning profile doesn't include the <capability>"`.

The order matters: declaring in code first means EAS's capability sync (which reverts
portal-only changes) won't undo your portal toggle on the next build.

## 12. Local iOS deploy (zero-EAS-Build)

`pnpm run deploy:ios:local` builds and uploads to TestFlight from your laptop without
using EAS Build infra (`scripts/deploy-ios-xcode.sh`: `expo prebuild` → `pod install` →
`xcodebuild archive` → `-exportArchive` → `xcrun altool --upload-app`). Useful when EAS
Build minutes are exhausted or you want to validate a build path that uses your actual
Xcode signing setup. The script preflights everything below — if anything's missing,
it prints the exact command and bails.

One-time setup:

- [ ] **Xcode + CLI tools**: install Xcode from the App Store (≥ 15), then
      `sudo xcode-select --install`. The script needs `xcodebuild`, `xcrun`, and `xcrun altool`.
- [ ] **CocoaPods** in PATH: `gem install cocoapods` (or `brew install cocoapods`). Note
      that brew's cocoapods will silently break if Homebrew bumps Ruby past the version
      its shim was built against — `gem install` against the active Ruby is the
      lowest-friction path.
- [ ] **Distribution certificate in any visible keychain** for team `Q65U6C65ZZ`. Plant
      once via either:

      ```bash
      cd apps/workshop && npx eas-cli@latest credentials -p ios
      ```

      (downloads the EAS-managed cert + installs into `login.keychain`), or export the
      `.p12` from <https://developer.apple.com/account/resources/certificates> and
      double-click to install.

- [ ] **App-Specific Password** for `xcrun altool` upload. Generate at
      <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Then:

      ```bash
      export ASC_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
      ```

      Or store in keychain once and reference by alias:

      ```bash
      xcrun altool --store-password-in-keychain-item ASC_PASSWORD \
        -u joshlebed@gmail.com -p '<password>'
      export ASC_APP_SPECIFIC_PASSWORD='@keychain:ASC_PASSWORD'
      ```

- [ ] **Signed into Apple ID in Xcode** (Settings → Accounts → "+"). The build runs with
      `-allowProvisioningUpdates` which lets Xcode fetch / create profiles on demand;
      without an Xcode-side Apple session, the archive step fails with a signing error.

After the one-time setup, every subsequent run is just:

```bash
pnpm run deploy:ios:local      # build + upload only
pnpm run deploy:local           # backend + OTA + local iOS, in order
```

Build numbers are timestamp-based (`YYYYMMDDHHMM`) so they're monotonically increasing
and don't collide with EAS-managed `appVersionSource: remote` values from CI runs.
TestFlight processing takes ~10 min after upload.

## Troubleshooting first-run

- **"Lambda returns 503 'not deployed yet'"**: the placeholder zip is still there. CI didn't run
  or failed — check Actions tab.
- **"Health check timed out during deploy"**: Lambda is cold-starting against an empty DB. The
  `migrate` job should have run first. Check that job's logs.
- **"SES SendEmail returns MessageRejected"**: either (a) you didn't verify the sender email, or
  (b) you're in sandbox mode trying to send to an unverified recipient.
- **"terraform apply fails on aws_budgets_budget"**: Budgets service isn't enabled on a brand-new
  AWS account. Visit Budgets in the AWS console once to initialize, then retry.
- **"Expo Go can't reach backend from my phone"**: if using local dev, your phone isn't on the
  same network as your laptop. Use the tunnel mode: `pnpm --filter workshop-app start -- --tunnel`.
