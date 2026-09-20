#!/usr/bin/env bash
# Service wrapper for the Hono backend (:8787). Sources apps/backend/.env,
# which .niteshift/setup writes with the resolved DATABASE_URL (Neon branch
# or local docker) + SESSION_SECRET — services don't receive setup's
# repository variables, and the manifest can't express "prefer the injected
# Neon URL, else the local one".
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
# shellcheck disable=SC1091
source "$REPO_DIR/.niteshift/files/toolchain.sh"
set -a
# shellcheck disable=SC1091
source apps/backend/.env
set +a
exec pnpm --filter @workshop/backend run dev
