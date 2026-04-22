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

In SES sandbox mode, you can only send mail to *verified* addresses. So for solo dev:

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
