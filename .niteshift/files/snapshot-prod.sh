#!/usr/bin/env bash
# Re-copy prod into the sandbox's local postgres (drops local data), then
# apply any migrations on this branch. Run from an agent shell:
#   .niteshift/files/snapshot-prod.sh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
# shellcheck disable=SC1091
source "$REPO_DIR/.niteshift/files/toolchain.sh"
# shellcheck disable=SC1091
source "$REPO_DIR/.niteshift/files/db.sh"
# Migrations read config from apps/backend/.env (written by setup).
set -a
# shellcheck disable=SC1091
source apps/backend/.env
set +a
workshop_resolve_database_url
workshop_ensure_local_postgres
workshop_snapshot_prod_into_local
pnpm --filter @workshop/backend run db:migrate
