# infra

Terraform for the `workshop` prod stack. One environment, one stack, on AWS.

Day-to-day this directory is auto-applied by CI on merge to `main`. You almost never
run `terraform apply` from your laptop.

## First-time setup

1. Create an HCP Terraform workspace `workshop-prod` in org `josh-personal-org`
   (<https://app.terraform.io>). Workspace should be "CLI-driven" workflow.
2. `terraform login` locally (stores a token in `~/.terraform.d/credentials.tfrc.json`).
3. Copy `terraform.tfvars.example` → `terraform.tfvars` and fill in. (CI uses workspace
   variables in HCP instead — see `manual-setup.md` §6.)
4. `terraform init` — pulls providers, connects to HCP.
5. `terraform apply` — first apply provisions everything; capture `api_url` and
   `github_actions_role_arn` from the outputs for GitHub secrets.

Agent-facing operational notes (deploy pipeline, state lock, role split, recovery):
`infra/CLAUDE.md`.
