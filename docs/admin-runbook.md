# Admin runbook

Lookup table for commands that need admin credentials. Per the canon/not-canon split,
this file is reference material — load only when you're about to run one of these.
Operational gotchas that apply every session live in `CLAUDE.md` / nested
`CLAUDE.md` files; per-symptom incident recovery lives in
`docs/recovery-runbook.md`.

## Getting credentials

- **Laptop**: secrets in `.admin.env` at the repo root (gitignored, mode 600). Run
  `/admin-elevate` to source + health-check.
- **Niteshift sandbox**: secrets injected as env vars. AWS uses role assumption (no
  static keys), 1h auto-refresh. Role defined in `infra/niteshift.tf`. Rotate External
  ID via Niteshift → Settings → Repositories → workshop → AWS → "Generate New ID",
  then update `var.niteshift_external_id` and apply.

## Common commands

| Goal                                | Command                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship an infra change                | Open PR; plan posts as comment. Merge → auto-applies.                                                                                                             |
| Preview infra change locally        | `cd infra && AWS_PROFILE=workshop-prod terraform plan`                                                                                                            |
| See what infra would change on main | `gh workflow run terraform.yml --ref main`                                                                                                                        |
| Tail prod logs                      | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error`                                                                                          |
| Trace one request                   | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter <reqid>`                                                                                                    |
| psql into Neon prod                 | `AWS_PROFILE=workshop-prod ./scripts/db-connect.sh`                                                                                                               |
| Neon branch for risky migration     | `neonctl branches create --name pre-<feature>` (needs `NEON_API_KEY`)                                                                                             |
| Read SSM secret                     | `AWS_PROFILE=workshop-prod aws ssm get-parameter --name /workshop-prod/X --with-decryption --query 'Parameter.Value' --output text`                               |
| Rotate SSM secret                   | `aws ssm put-parameter --name /workshop-prod/X --value … --overwrite --type SecureString` (SSM resources have `ignore_changes = [value]`)                         |
| Deploy web to preview               | `pnpm deploy:pages:preview`                                                                                                                                       |
| Deploy web to prod                  | `pnpm deploy:pages` (always-confirm)                                                                                                                              |
| Force a fresh TestFlight build      | `gh workflow run testflight.yml --ref main --field force=true`                                                                                                    |
| Bypass EAS submit (queue jammed)    | Download IPA from EAS dashboard, then `xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa -u joshlebed@gmail.com -p "$APPLE_APP_SPECIFIC_PASSWORD"` |

## Authorization tiers

Once `/admin-elevate` is active (or in a Niteshift sandbox with the AWS role assumed):

**Auto-allowed** (do it, mention in chat):

- `terraform plan/output/state list`, log reads
- `aws ssm get-parameter` (incl. `--with-decryption`)
- `aws lambda get-function-configuration/get-function`
- `pnpm deploy:pages:preview` (preview branch)
- `neonctl branches create` (non-`main`/`prod*`)
- Lambda env var rotation via `aws lambda update-function-configuration` (reverted on
  next apply if SSM source ignores changes)
- Rerunning failed CI, `gh workflow run` for non-deploy workflows

**Always confirm** with the user first:

- Manual `terraform apply` (CI applies on merge)
- Any Cloudflare DNS change
- `pnpm deploy:pages` to production
- Any change to GH branch protection or required checks
- `neonctl branches delete` for `main` or `prod*`
- Apple Developer Portal capability toggles
- OIDC provider rotation, GH Actions IAM role policy edits
- Adding a new AWS service
- Anything in a different AWS account

**Prohibited**:

- Force-push to `main`
- `terraform destroy` on prod
- `DROP TABLE` / `TRUNCATE` on prod Neon
- Rotating `SESSION_SECRET` without warning the user (invalidates all sessions)
- Removing Niteshift's IAM role trust policy while a task is in-flight

## Sources of truth (external systems)

Change something in the system below; don't trust caches in code or Terraform.

| System                          | URL                                                                                    | Owns                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **EAS dashboard**               | <https://expo.dev/accounts/joshlebed/projects/workshop>                                | iOS build history + IPAs, submission queue, fingerprint tags, EAS Update channels                |
| **App Store Connect**           | <https://appstoreconnect.apple.com>                                                    | TestFlight builds, app metadata, ASC API keys                                                    |
| **Apple Developer Portal**      | <https://developer.apple.com/account/resources/identifiers/list>                       | App IDs, capabilities, App Groups, provisioning profiles, signing certificates                   |
| **Google Cloud Console**        | <https://console.cloud.google.com/apis/credentials?project=workshop-494616&authuser=1> | OAuth client IDs, API keys (Books)                                                               |
| **TMDB**                        | <https://www.themoviedb.org/settings/api>                                              | TMDB v3 API key                                                                                  |
| **AWS SSM Parameter Store**     | `aws ssm describe-parameters` (prefix `/workshop-prod/`)                               | Lambda env values; SSM resources have `lifecycle { ignore_changes = [value] }`                   |
| **HCP Terraform**               | <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>              | All AWS infra state                                                                              |
| **Cloudflare Pages**            | <https://dash.cloudflare.com/?to=/:account/pages/view/workshop>                        | Web build env vars (`EXPO_PUBLIC_*`), production URL `workshop-a2v.pages.dev`                    |
| **GitHub Actions**              | <https://github.com/joshlebed/workshop/actions>                                        | CI runs, deploy runs, fingerprint tags (as git tags)                                             |
| **Neon**                        | connection string in SSM `/workshop-prod/db/url`                                       | Production Postgres                                                                              |
| **Discord (`#workshop-admin`)** | webhook in SSM `/workshop-prod/discord/notify_webhook_url`                             | Operator notifications. Rotate via channel ⚙ → Integrations → Webhooks, then `ssm put-parameter` |
