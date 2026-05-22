---
description: Source the workshop repo's `.admin.env` into the current session so this agent can use admin tokens (TF_API_TOKEN, CLOUDFLARE_API_TOKEN, EXPO_TOKEN, NEON_API_KEY), then run a health-check sweep that verifies every credential is alive. TRIGGER when the user asks to "elevate", "go admin", "use admin access", run `terraform apply`, deploy via wrangler, rotate a secret, or take any action that needs more than read-only access. SKIP for everyday read-only debugging — `./scripts/logs.sh`, `psql` via the AWS SSO profile, and `terraform plan` already work without elevation. GitHub is intentionally absent — Niteshift auto-injects it in sandbox; on laptop, `gh auth login` (web) is canonical.
---

# /admin-elevate

Sources the admin secrets file and verifies the credentials work. Run this
once at the start of a session that needs admin access; subsequent commands
in the same shell pick up the env vars.

## What this skill does

1. Sources `<repo>/.admin.env` (gitignored, mode 600) so `TF_API_TOKEN`,
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`,
   `NEON_API_KEY`, and the Apple bits are available to subsequent
   commands. GitHub is intentionally absent — `gh auth login` handles
   it on the laptop, and Niteshift auto-injects it in sandbox.
2. Runs a one-shot health sweep — `aws sts get-caller-identity`,
   `gh auth status`, `wrangler whoami`, `curl <api>/health`, and a
   terraform-token probe — and reports which credentials are live vs missing
   vs expired.
3. Echoes back a one-line "admin mode active — TF ✓ CF ✓ GH ✓ Expo ✓ AWS ✓"
   summary so the rest of the session knows what's wired.

## Playbook

Run this as one shell snippet (so the `source` and the subsequent checks
share an env):

```bash
set +e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "FAIL: not inside a git repo — cd into the workshop repo first"
  exit 1
fi
ADMIN_ENV="$REPO_ROOT/.admin.env"
source "$ADMIN_ENV" 2>/dev/null || { echo "FAIL: $ADMIN_ENV not found — see CLAUDE.md 'Admin runbook'"; exit 1; }

echo "── admin-elevate health check ──"

# AWS — use SSO profile on laptop; in Niteshift sandbox AWS_* is already injected.
if aws sts get-caller-identity --profile workshop-prod >/dev/null 2>&1; then
  echo "✓ AWS  (workshop-prod SSO)"
elif aws sts get-caller-identity >/dev/null 2>&1; then
  echo "✓ AWS  (sandbox-injected)"
else
  echo "✗ AWS  — run: aws sso login --profile workshop-prod"
fi

# HCP Terraform — probe the user account endpoint with the bearer token.
if [ -n "$TF_API_TOKEN" ] && curl -fsS -H "Authorization: Bearer $TF_API_TOKEN" \
    https://app.terraform.io/api/v2/account/details >/dev/null 2>&1; then
  echo "✓ TF   (HCP token)"
else
  echo "✗ TF   — generate at https://app.terraform.io/app/settings/tokens"
fi

# Cloudflare — token verify endpoint.
if [ -n "$CLOUDFLARE_API_TOKEN" ] && curl -fsS \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    https://api.cloudflare.com/client/v4/user/tokens/verify | grep -q '"status":"active"'; then
  echo "✓ CF   (token + account=$CLOUDFLARE_ACCOUNT_ID)"
else
  echo "✗ CF   — generate at https://dash.cloudflare.com/profile/api-tokens"
fi

# GitHub — uses ambient gh-cli auth (web login on laptop, niteshift injection in sandbox).
if gh auth status >/dev/null 2>&1; then
  echo "✓ GH   (ambient)"
else
  echo "✗ GH   — run: gh auth login"
fi

# Expo — whoami endpoint.
if [ -n "$EXPO_TOKEN" ] && EXPO_TOKEN="$EXPO_TOKEN" npx -y eas-cli@latest whoami >/dev/null 2>&1; then
  echo "✓ Expo (EAS token)"
else
  echo "✗ Expo — generate at https://expo.dev/accounts/joshlebed/settings/access-tokens"
fi

# API health (sanity check the env actually targets prod).
API_URL=$(cd infra 2>/dev/null && AWS_PROFILE=workshop-prod terraform output -raw api_url 2>/dev/null) || API_URL=""
if [ -n "$API_URL" ] && curl -fsS "$API_URL/health" >/dev/null 2>&1; then
  echo "✓ API  ($API_URL/health 200)"
fi

echo "── admin mode active ──"
```

After the sweep, report the result to the user as one line: "admin mode
active — TF ✓ CF ✓ GH ✓ Expo ✓ AWS ✓" (or list the ✗s explicitly).

## What's auto-allowed vs always-confirm

This is in `CLAUDE.md` ("Admin actions: auto-allowed vs always-confirm")
but worth re-reading before taking destructive action. The short version:

- **Auto-allowed:** `terraform plan`, log reads, SSM `get-parameter`,
  Neon branch create, Cloudflare Pages preview deploys, small (<5 resource)
  terraform applies touching only cors/lambda-env/SSM.
- **Always confirm:** large terraform applies, IAM changes, DNS changes,
  GH branch-protection changes, production Pages deploys, Neon branch
  delete on `main`/`prod*`, Apple capability toggles, OIDC rotation.

When in doubt, ask. The cost of one extra confirmation prompt is much
lower than the cost of an unintended rotation.
