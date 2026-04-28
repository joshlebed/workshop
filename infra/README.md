# infra

Terraform for the whole `workshop` prod stack. One environment, one stack.

## Layout

- `versions.tf` — Terraform + provider versions, HCP Terraform backend config
- `providers.tf` — AWS provider
- `variables.tf` / `locals.tf` / `outputs.tf` — inputs / derived / outputs
- `ssm.tf` — SSM SecureString params (DATABASE_URL from Neon, SESSION_SECRET)
- `lambda.tf` — Lambda function + role + log group (code replaced by CI)
- `apigateway.tf` — HTTP API Gateway, catch-all → Lambda
- `ses.tf` — Email identity for the sender (sandbox mode)
- `iam_github_oidc.tf` — OIDC role that GitHub Actions assumes
- `budgets.tf` — $5/month cost alert

## First-time setup

1. Create HCP Terraform org `joshlebed` and workspace `workshop-prod` at
   <https://app.terraform.io>. Workspace should be "CLI-driven" workflow.
2. `terraform login` locally (stores a token in `~/.terraform.d/credentials.tfrc.json`).
3. Copy `terraform.tfvars.example` → `terraform.tfvars` and fill in.
   (In CI, set these as workspace variables in HCP instead.)
4. `terraform init` — pulls providers, connects to HCP.
5. `terraform apply`.
6. **After apply, check your email for an SES verification link and click it.**
   Lambda can't send mail until the identity is verified.
7. Capture `api_url` and `github_actions_role_arn` from outputs — you'll set
   `AWS_ROLE_ARN` and `EXPO_PUBLIC_API_URL` in GitHub secrets.

## Database

Postgres is managed externally by Neon (see `docs/decisions.md`). The
connection string is provided via `var.database_url` in
`terraform.tfvars` and plumbed to the Lambda through an SSM
SecureString. Rotate by updating the tfvars value and running
`terraform apply`.
