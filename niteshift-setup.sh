#!/usr/bin/env bash
# Niteshift setup for joshlebed/workshop
# - Starts PostgreSQL 16 in a docker container using host networking
#   (Niteshift DinD bridge networking is broken, so --network=host is required).
# - Installs pnpm deps, writes apps/backend/.env from sandbox env, runs Drizzle
#   migrations, then runs the Hono backend (:8787) AND the Expo web app (:8081)
#   side-by-side via `concurrently`. The web app is the primary preview surface
#   — it renders the React Native app in the browser via react-native-web.
# - Native iOS isn't runnable inside the sandbox; ship via EAS instead.
set -euo pipefail

REPO_DIR="/root/workshop"
LOG_PREFIX="[niteshift-setup]"

log() { printf '%s %s\n' "$LOG_PREFIX" "$*"; }

# Source the sandbox env file so this script can be re-run from a fresh shell
# (e.g. manual restart after `pnpm install` killed the dev servers). Without
# this, `set -u` trips on unbound DATABASE_URL / SESSION_SECRET when Niteshift
# isn't the parent process. See AGENT-REFLECTIONS.md 2026-04-28 (Phase 5a).
if [ -f /.env.setup ]; then
  # shellcheck disable=SC1091
  set -a; source /.env.setup; set +a
fi

cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# 1) Keep working tree clean — exclude files we create from git status
# ---------------------------------------------------------------------------
EXCLUDE_FILE=".git/info/exclude"
for entry in "apps/backend/.env" ".claude/"; do
  if ! grep -qxF "$entry" "$EXCLUDE_FILE" 2>/dev/null; then
    printf '%s\n' "$entry" >> "$EXCLUDE_FILE"
  fi
done

# ---------------------------------------------------------------------------
# 2) Start Postgres 16 (idempotent, host networking)
# ---------------------------------------------------------------------------
PG_CONTAINER="workshop-pg"

if ! docker info >/dev/null 2>&1; then
  log "docker not available" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    log "starting existing postgres container"
    docker start "$PG_CONTAINER" >/dev/null
  else
    log "postgres container already running"
  fi
else
  log "creating postgres container ($PG_CONTAINER) with host networking"
  docker run -d \
    --name "$PG_CONTAINER" \
    --network=host \
    --restart=unless-stopped \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=workshop \
    postgres:16 >/dev/null
fi

log "waiting for postgres to accept connections"
for i in $(seq 1 60); do
  if docker exec "$PG_CONTAINER" pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    log "postgres ready"
    break
  fi
  if [ "$i" = 60 ]; then
    log "postgres did not become ready in 30s" >&2
    docker logs --tail 50 "$PG_CONTAINER" >&2 || true
    exit 1
  fi
  sleep 0.5
done

# ---------------------------------------------------------------------------
# 3) Install dependencies (idempotent)
# ---------------------------------------------------------------------------
log "pnpm install"
pnpm install --prefer-offline

# ---------------------------------------------------------------------------
# 4) Dev-auth flags — the sandbox is a non-prod environment, so make the
#    `sign-in-dev` testID available by default. This matches `scripts/e2e.sh`
#    and lets agent-browser / the user's preview iframe sign in without the
#    "kill servers, run e2e, restart" ritual described in AGENT-REFLECTIONS.md
#    2026-04-28 (auth in dev).
# ---------------------------------------------------------------------------
export DEV_AUTH_ENABLED="${DEV_AUTH_ENABLED:-1}"
export EXPO_PUBLIC_DEV_AUTH="${EXPO_PUBLIC_DEV_AUTH:-1}"

# ---------------------------------------------------------------------------
# 5) Write apps/backend/.env from sandbox env vars
#    (the backend reads process.env directly; this file is a convenience
#    for any locally-run tooling like drizzle-kit that sources .env).
# ---------------------------------------------------------------------------
log "writing apps/backend/.env"
cat > apps/backend/.env <<EOF
STAGE=${STAGE:-local}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
SES_FROM_ADDRESS=${SES_FROM_ADDRESS:-noreply@example.com}
AWS_REGION=${AWS_REGION:-us-east-1}
LOG_LEVEL=${LOG_LEVEL:-debug}
PORT=${PORT:-8787}
DEV_AUTH_ENABLED=${DEV_AUTH_ENABLED}
EOF

# ---------------------------------------------------------------------------
# 6) Drizzle migrations
# ---------------------------------------------------------------------------
log "running db migrations"
pnpm --filter @workshop/backend run db:migrate

# ---------------------------------------------------------------------------
# 7) Seed dev data (idempotent — exits without changes if seed user has lists).
#    Populates the preview user (`preview@workshop.local`, the same identity the
#    web app's auto-dev-sign-in uses) with a mix of movie/tv/book/date/trip/game
#    lists so the agent or human lands on a non-empty UI on first load. Set
#    SEED_DEV_DATA=0 to skip (e.g. when reproducing an empty-state bug).
# ---------------------------------------------------------------------------
if [ "${SEED_DEV_DATA:-1}" = "1" ]; then
  log "seeding dev data"
  pnpm --filter @workshop/backend run db:seed
else
  log "SEED_DEV_DATA=0 — skipping dev data seed"
fi

# ---------------------------------------------------------------------------
# 8) Start backend (:8787) + Expo web (:8081) in parallel.
#    EXPO_PUBLIC_API_URL points the browser at the backend preview URL so
#    fetch() calls from the React Native web bundle cross the Niteshift proxy
#    to the sandbox — localhost:8787 isn't reachable from the user's browser.
# ---------------------------------------------------------------------------
WEB_PORT="${WEB_PORT:-8081}"
BACKEND_PORT="${PORT:-8787}"

# Prefer the explicit backend preview URL; fall back to localhost for runs
# outside the cloud sandbox (e.g. a local reproduction of this script).
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-${NITESHIFT_BACKEND_URL:-http://localhost:${BACKEND_PORT}}}"
log "EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}"
log "DEV_AUTH_ENABLED=${DEV_AUTH_ENABLED} EXPO_PUBLIC_DEV_AUTH=${EXPO_PUBLIC_DEV_AUTH}"
# Whitelist the Niteshift preview origin in Expo CLI's CorsMiddleware.
# `apps/workshop/app.config.ts` reads this and surfaces it as
# `expo.extra.router.origin`, which the middleware adds to its allow-list
# in addition to `localhost`. Without this, POST/PATCH/DELETE requests
# from the iframe-hosted preview are rejected with a 401 HTML page before
# our `/api/*` dev proxy can handle them.
log "NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL=${NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL:-(unset)}"
log "starting backend on :${BACKEND_PORT} and web app on :${WEB_PORT}"

exec pnpm exec concurrently \
  --names "backend,web" \
  --prefix-colors "cyan.bold,magenta.bold" \
  --kill-others-on-fail \
  "pnpm --filter @workshop/backend run dev" \
  "pnpm --filter workshop-app run web"
