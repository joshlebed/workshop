#!/usr/bin/env bash
# Service wrapper for the Hono backend (:8787). Sources apps/backend/.env,
# which .niteshift/setup writes with the local DATABASE_URL + SESSION_SECRET —
# services don't receive setup's repository variables.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
# shellcheck disable=SC1091
source "$REPO_DIR/.niteshift/files/toolchain.sh"
set -a
# shellcheck disable=SC1091
source apps/backend/.env
set +a
# The sandbox DB is a prod copy with real push tokens: never let a local send
# reach Expo. Default to the local stub service (`expo-push-stub`, :8790);
# with the stub down a send fails to connect, which is just as safe.
export EXPO_PUSH_URL="${EXPO_PUSH_URL:-http://127.0.0.1:8790/--/api/v2/push/send}"
exec pnpm --filter @workshop/backend run dev
