#!/usr/bin/env bash
# Build the Workshop web app and deploy it (plus the Pages Functions at
# `functions/`) directly to Cloudflare Pages via wrangler.
#
# This bypasses Cloudflare Pages' git-source auto-build entirely, which is
# the only place CF Pages build failures are visible before this script —
# the dashboard logs are the only signal that a deploy failed (they don't
# show up in GH Actions or anywhere obvious). Use this when you need a
# fast feedback loop or want to verify a fix without waiting on CI/CD.
#
# Usage:
#   ./scripts/deploy-pages.sh                  # → production (branch=main)
#   ./scripts/deploy-pages.sh --preview        # → preview branch named after current git branch
#   ./scripts/deploy-pages.sh --branch=NAME    # → preview branch with explicit name
#
# Auth: either `wrangler login` once (creds cached in
# `~/Library/Preferences/.wrangler/config/`) or `CLOUDFLARE_API_TOKEN`
# in env. Wrangler 4 requires Node 22; this script picks it up via nvm
# automatically if available, otherwise expects it on PATH.

set -euo pipefail

BRANCH=""
for arg in "$@"; do
  case "$arg" in
    --branch=*) BRANCH="${arg#*=}" ;;
    --preview)
      BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null | tr '/' '-' | tr '[:upper:]' '[:lower:]')"
      BRANCH="${BRANCH:-local-preview}"
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done
BRANCH="${BRANCH:-main}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# wrangler@latest (v4) needs Node ≥22. If the active node is older, try to
# switch via nvm; the failure mode is loud, not silent.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    nvm install 22 >/dev/null 2>&1 || true
    nvm use 22 >/dev/null
  else
    echo "✗ wrangler@latest requires Node 22; you're on $(node -v). Install via nvm or mise." >&2
    exit 1
  fi
fi

echo "▶ building apps/workshop/dist..."
pnpm --filter workshop-app exec expo export --platform web 1>/dev/null

echo "▶ deploying to Cloudflare Pages (project=workshop, branch=$BRANCH)..."
npx -y wrangler@latest pages deploy apps/workshop/dist \
  --project-name=workshop \
  --branch="$BRANCH" \
  --commit-dirty=true
