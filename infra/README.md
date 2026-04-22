# infra

Terraform for the whole `workshop` prod stack. One environment, one stack.

## Layout

- `versions.tf` — Terraform + provider versions, HCP Terraform backend config
- `providers.tf` — AWS provider
- `variables.tf` / `locals.tf` / `outputs.tf` — inputs / derived / outputs
- `rds.tf` — PostgreSQL t4g.micro, public + SSL-required, secrets in SSM
- `lambda.tf` — Lambda function + role + log group (code replaced by CI)
- `apigateway.tf` — HTTP API Gateway, catch-all → Lambda
- `ses.tf` — Email identity for the sender (sandbox mode)
- `iam_github_oidc.tf` — OIDC role that GitHub Actions assumes
- `budgets.tf` — $5/month cost alert

## First-time setup

1. Create HCP Terraform org `joshlebed` and workspace `workshop-prod` at
   <https://app.terraform.io>. Workspace should be "CLI-driven" workflow.
2. `terraform login` locally (stores a token in `~/.terraform.d/credentials.tfrc.json`).
3. Copy `terraform.tfvars.example` → `terraform.tfvars.local` and fill in.
   (In CI, set these as workspace variables in HCP instead.)
4. `terraform init` — pulls providers, connects to HCP.
5. `terraform apply -var-file=terraform.tfvars.local`.
6. **After apply, check your email for an SES verification link and click it.**
   Lambda can't send mail until the identity is verified.
7. Capture `api_url` and `github_actions_role_arn` from outputs — you'll set
   `AWS_ROLE_ARN` and `EXPO_PUBLIC_API_URL` in GitHub secrets.

## Changing RDS

The default `publicly_accessible = true` is documented as prototype-only in
`docs/decisions.md`. Before launching to real users, move the DB into a VPC
and update Lambda to run inside it — see that doc for the migration plan.
