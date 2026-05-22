# infra — coding agent guide

Terraform for the whole prod stack. One environment (`workshop-prod`), one stack. HCP
Terraform state, org `josh-personal-org`, workspace `workshop-prod`, Local execution.

CI auto-applies on merge to `main`. Don't run `terraform apply` from your laptop unless
recovering from a stuck pipeline.

## AWS access

- **Local**: `aws sso login --profile workshop-prod`, prefix commands with
  `AWS_PROFILE=workshop-prod`.
- **CI**: assumes `workshop-prod-github-actions` via OIDC, scoped to this repo on
  `main`, PRs, and the `production` environment.
- **Niteshift sandbox**: AWS role assumption (no static keys), 1h auto-refresh. Role
  defined in `niteshift.tf`. Rotate External ID via Niteshift UI, update
  `var.niteshift_external_id`, apply.

Account ID / org ID live in `terraform.tfvars` (gitignored). Region: `us-east-1`.

## Deploy pipeline

`.github/workflows/terraform.yml` owns the lifecycle:

- **PR** (paths: `infra/**` or `terraform.yml`) → `terraform plan -detailed-exitcode
-refresh=false`, sticky PR comment. Informational, not a required check.
- **Push to `main`** → `terraform apply -auto-approve` + `/health` smoke test. No human
  gate beyond PR review.
- **Weekly cron** (Mon 13:00 UTC) + `workflow_dispatch` → plan; opens/updates a single
  `infra-drift` issue on drift.

**Two roles, by blast radius:** plan uses narrow `AWS_ROLE_ARN` (Lambda + scoped SSM),
runs with `-refresh=false` so it doesn't 403 on SSM params it can't read. Apply uses
`AWS_ROLE_ARN_TF_APPLY` (`AdministratorAccess`), assumable only by
`ref:refs/heads/main`. Apply needs broad perms because Terraform manages IAM (including
this role's own trust policy).

**A new `data` source on a non-SSM resource the plan role can't read WILL fail plan** —
expand the role in the same PR or split.

**Variables**: HCP workspace is Local-mode so vars aren't auto-injected. `database_url`
is fetched from SSM at job runtime; `niteshift_external_id` from a GH secret;
everything else (Apple/Google/TMDB/Books/Spotify) uses empty-string defaults — backing
SSM params have `lifecycle { ignore_changes = [value] }`, so apply doesn't clobber
ops-set values.

If you add a new required var (no default), wire it into both jobs' env blocks **and**
add the matching GH secret in the same PR.

## SSM is the secrets store

DB password, session secret, OAuth audiences, third-party API keys — all in
`/workshop-prod/*` SecureStrings, read by Lambda via env. SSM resources have
`lifecycle { ignore_changes = [value] }` so ops can rotate without Terraform clobbering.
Don't commit secrets to `terraform.tfvars`.

## HCP Terraform state lock

HCP's state lock doesn't auto-release when terraform is killed. Symptom: `Error
acquiring the state lock`. Fix: workspace UI → **Unlock** (top right). Prefer UI unlock
over `-lock=false`.

## Recovery

- Plan failed → fix on a new PR.
- Apply failed partway → HCP locks; next push retries, or run locally with same vars
  (state is in HCP, so local apply is safe).
- State lock stuck → unlock in HCP UI.

Per-symptom recovery (TestFlight, EAS, CORS preflights, etc.) lives in
`docs/recovery-runbook.md`. Admin commands live in `docs/admin-runbook.md`.

## File layout

- `versions.tf` / `providers.tf` — Terraform + AWS provider versions
- `variables.tf` / `locals.tf` / `outputs.tf` — inputs / derived / outputs
- `ssm.tf` — SSM SecureString params
- `lambda.tf` — Lambda function + role + log group (code replaced by CI)
- `apigateway.tf` — HTTP API Gateway, catch-all → Lambda (CORS allowMethods lives here)
- `iam_github_oidc.tf` — OIDC roles for GitHub Actions
- `niteshift.tf` — IAM role for Niteshift sandbox access
- `budgets.tf` — $5/month cost alert
