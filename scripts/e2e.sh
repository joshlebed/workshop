#!/usr/bin/env bash
# Run the Playwright E2E suite against the local dev servers.
# Starts backend (:8787) + web (:8081) with the dev-auth flags enabled,
# waits for both to be healthy, then runs `playwright test`.
#
# Prereqs:
#   • `pnpm install` has completed
#   • Chromium is installed: `npx playwright install chromium`
#   • Nothing else is bound to :8787 / :8081
set -euo pipefail

cd "$(dirname "$0")/.."

BACKEND_PORT="${BACKEND_PORT:-8787}"
WEB_PORT="${WEB_PORT:-8081}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"

# Load backend env (DATABASE_URL, SESSION_SECRET) — the test reuses the dev DB.
if [ -f apps/backend/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source apps/backend/.env
  set +a
fi

export DEV_AUTH_ENABLED=1
export EXPO_PUBLIC_DEV_AUTH=1
export EXPO_PUBLIC_API_URL="$BACKEND_URL"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "→ starting backend (:${BACKEND_PORT}) with DEV_AUTH_ENABLED=1"
pnpm --filter @workshop/backend run dev >/tmp/workshop-e2e-backend.log 2>&1 &
BACKEND_PID=$!

printf "  waiting for %s/health" "$BACKEND_URL"
for _ in $(seq 1 60); do
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 1
done

echo "→ starting web (:${WEB_PORT}) with EXPO_PUBLIC_DEV_AUTH=1"
pnpm --filter workshop-app run web >/tmp/workshop-e2e-web.log 2>&1 &
WEB_PID=$!

printf "  waiting for %s" "$WEB_URL"
for _ in $(seq 1 120); do
  if curl -fsS "$WEB_URL" >/dev/null 2>&1; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 1
done

echo "→ playwright test"
pnpm exec playwright test "$@"
