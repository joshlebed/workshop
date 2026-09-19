#!/usr/bin/env bash
# Niteshift setup for joshlebed/workshop
# - Database: local PostgreSQL in docker, hydrated from a pg_dump of prod on
#   first boot. Local means sub-millisecond queries (a remote Neon branch costs
#   0.5-2s per read and has been seen to take 13s on a write); dumping prod
#   means the sandbox still has prod-shaped data, which a hand-written seed
#   can't match. Container uses host networking because Niteshift DinD bridge
#   networking is broken.
#   An injected remote DATABASE_URL (Niteshift's database-branches integration)
#   still takes precedence when it is actually reachable, so turning that
#   integration on or off is a settings decision, not a code change.
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
# 0) Bootstrap mise + install pinned toolchain (node, pnpm, …).
#    The sandbox base image ships Node 22, but the repo pins Node 20.19 in
#    .mise.toml / .nvmrc and root package.json engines (`>=20.19 <21`).
#    Without mise, every pnpm invocation emits `WARN Unsupported engine`
#    and we're running the dev servers on a node version CI never sees.
#    Idempotent: mise install is a no-op once the pinned versions are cached.
# ---------------------------------------------------------------------------
export MISE_DATA_DIR="${MISE_DATA_DIR:-$HOME/.local/share/mise}"
# Pinned mise release. SHA256 values are the upstream-published checksums from
#   https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/SHASUMS256.txt
# Bump both VERSION and the matching SHA when upgrading; never replace this with
# `curl https://mise.run | sh`, which executes arbitrary code from an
# unauthenticated download.
MISE_VERSION="2025.10.10"
MISE_SHA256_LINUX_X64="046708144e13d918801511845b44cb5e2a4414d616741ce24720c34f7d370a7d"
MISE_SHA256_LINUX_ARM64="ef86eba7f8adba1160bd1df43b7549d1acaaf965567562cf77891295dd1e3fcf"

install_mise_pinned() {
  local arch tarball expected_sha tmp
  case "$(uname -m)" in
    x86_64|amd64) arch="linux-x64"; expected_sha="$MISE_SHA256_LINUX_X64" ;;
    aarch64|arm64) arch="linux-arm64"; expected_sha="$MISE_SHA256_LINUX_ARM64" ;;
    *) log "unsupported architecture for pinned mise install: $(uname -m)" >&2; return 1 ;;
  esac
  tarball="mise-v${MISE_VERSION}-${arch}.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  log "downloading mise v${MISE_VERSION} (${arch})"
  curl -fsSL --retry 3 --retry-delay 2 \
    -o "$tmp/$tarball" \
    "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/${tarball}"
  printf '%s  %s\n' "$expected_sha" "$tmp/$tarball" | sha256sum -c -
  tar -xzf "$tmp/$tarball" -C "$tmp"
  mkdir -p "$HOME/.local/bin"
  install -m 0755 "$tmp/mise/bin/mise" "$HOME/.local/bin/mise"
}

if ! command -v mise >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/mise" ]; then
  log "installing mise"
  install_mise_pinned
fi
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$PATH"
log "installing pinned toolchain via mise ($(mise --version))"
mise trust --quiet "$REPO_DIR/.mise.toml"
mise install

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
# 2) Database.
#
#    Order of preference:
#      a) an injected remote DATABASE_URL that actually answers   -> use it
#      b) local docker postgres hydrated from a pg_dump of prod   -> default
#      c) local docker postgres + the dev seed fixtures           -> fallback
#
#    (a) is probed rather than trusted. Niteshift's database-branches
#    integration hands the sandbox a per-task Neon branch, and that branch can
#    be reclaimed underneath a *running* sandbox — migrations succeed at boot,
#    then every later query fails `28P01 password authentication failed` and
#    the app surfaces it as "can't sign in". Probing turns that into a visible
#    line in the setup log and a working local database instead of a dead one.
#
#    Override with WORKSHOP_DB_SOURCE=prod|seed|remote.
# ---------------------------------------------------------------------------
PG_CONTAINER="workshop-pg"
# Match prod: Neon runs PostgreSQL 17, and pg_dump refuses to dump a server
# newer than itself ("aborting because of server version mismatch").
PG_IMAGE="postgres:17"
LOCAL_DATABASE_URL="postgres://postgres:postgres@localhost:5432/workshop"
DB_SOURCE="${WORKSHOP_DB_SOURCE:-auto}"

db_answers() {
  # Cheap liveness probe. Uses the pinned postgres image so we never depend on
  # a psql client being installed on the host. The URL goes in via the
  # environment, never argv, so it stays out of the container's process list.
  docker run --rm -e PGURL="$1" "$PG_IMAGE" \
    sh -c 'psql "$PGURL" -tAc "select 1"' >/dev/null 2>&1
}

start_local_pg() {
  if ! docker info >/dev/null 2>&1; then
    log "docker not available" >&2
    exit 1
  fi

  # Recreate the container if it predates a PG_IMAGE bump — a PG16 data
  # directory will not start under a PG17 binary.
  if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    local have
    have="$(docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER" 2>/dev/null || true)"
    if [ "$have" != "$PG_IMAGE" ]; then
      log "postgres container is $have, want $PG_IMAGE — recreating"
      docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
    fi
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
      log "starting existing postgres container"
      docker start "$PG_CONTAINER" >/dev/null
    else
      log "postgres container already running"
    fi
  else
    log "creating postgres container ($PG_CONTAINER, $PG_IMAGE) with host networking"
    docker run -d \
      --name "$PG_CONTAINER" \
      --network=host \
      --restart=unless-stopped \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_DB=workshop \
      "$PG_IMAGE" >/dev/null
  fi

  log "waiting for postgres to accept connections"
  for i in $(seq 1 60); do
    if docker exec "$PG_CONTAINER" pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      log "postgres ready"
      return 0
    fi
    if [ "$i" = 60 ]; then
      log "postgres did not become ready in 30s" >&2
      docker logs --tail 50 "$PG_CONTAINER" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
}

local_db_is_empty() {
  local n
  n="$(docker exec "$PG_CONTAINER" psql -U postgres -d workshop -tAc \
    "select count(*) from information_schema.tables where table_schema = 'public'" 2>/dev/null || echo 0)"
  [ "${n:-0}" -eq 0 ]
}

# Read-only. pg_dump cannot write, and nothing here ever opens prod for write.
hydrate_from_prod() {
  local prod_url
  prod_url="$(aws ssm get-parameter \
    --name /workshop-prod/db/url --with-decryption \
    --query 'Parameter.Value' --output text 2>/dev/null || true)"
  if [ -z "$prod_url" ] || [ "$prod_url" = "None" ]; then
    log "no prod DATABASE_URL in SSM (need the sandbox AWS role) — using dev seed instead"
    return 1
  fi

  log "hydrating local postgres from a prod dump (read-only pg_dump)"
  # Dump and restore inside the container: one hop, version-matched client,
  # and no copy of production data left on the sandbox filesystem.
  if docker exec -e PGURL="$prod_url" "$PG_CONTAINER" sh -c \
      'set -o pipefail; pg_dump --no-owner --no-acl "$PGURL" | psql -U postgres -d workshop -q -v ON_ERROR_STOP=1' \
      >/dev/null 2>/tmp/workshop-pg-hydrate.err; then
    log "prod dump restored"
    return 0
  fi
  log "prod dump failed — using dev seed instead. Last lines:" >&2
  tail -5 /tmp/workshop-pg-hydrate.err >&2 || true
  # Leave a clean slate so the seed path isn't restoring onto a half dump.
  docker exec "$PG_CONTAINER" psql -U postgres -d workshop -q -c \
    'drop schema if exists public cascade; create schema public;' >/dev/null 2>&1 || true
  docker exec "$PG_CONTAINER" psql -U postgres -d workshop -q -c \
    'drop schema if exists drizzle cascade;' >/dev/null 2>&1 || true
  return 1
}

USE_REMOTE_DB=0
HYDRATED_FROM_PROD=0

case "${DATABASE_URL:-}" in
  ""|*localhost*|*127.0.0.1*) : ;;
  *)
    if [ "$DB_SOURCE" = "remote" ] || [ "$DB_SOURCE" = "auto" ]; then
      if ! docker info >/dev/null 2>&1; then
        # No docker means there is no local fallback to fall back *to*, and the
        # probe itself needs it — trust the injected URL, as the pre-probe code
        # always did.
        log "docker unavailable — using injected remote DATABASE_URL unprobed"
        USE_REMOTE_DB=1
      elif log "probing injected remote DATABASE_URL" && db_answers "$DATABASE_URL"; then
        log "remote DATABASE_URL is reachable — using it, skipping local postgres"
        USE_REMOTE_DB=1
      else
        log "remote DATABASE_URL did NOT answer — falling back to local postgres." >&2
        log "  (a per-task Neon branch reclaimed mid-session looks exactly like this;" >&2
        log "   see docs/recovery-runbook.md 'sandbox database stops authenticating')" >&2
      fi
    fi
    ;;
esac

if [ "$USE_REMOTE_DB" = "0" ]; then
  start_local_pg
  if local_db_is_empty; then
    case "$DB_SOURCE" in
      seed) log "WORKSHOP_DB_SOURCE=seed — skipping the prod dump" ;;
      *)    hydrate_from_prod && HYDRATED_FROM_PROD=1 ;;
    esac
  else
    log "local postgres already has data — leaving it alone"
    HYDRATED_FROM_PROD=1
  fi
  DATABASE_URL="$LOCAL_DATABASE_URL"
  export DATABASE_URL
fi

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
#    Populates the preview user (`joshlebed@gmail.com`, the same identity the
#    web app's auto-dev-sign-in uses) with a mix of movie/tv/book/date/trip/game
#    lists so the agent or human lands on a non-empty UI on first load. Set
#    SEED_DEV_DATA=0 to skip (e.g. when reproducing an empty-state bug).
#
#    Default off whenever the database already holds prod-shaped data — a
#    reachable remote branch, or a local database hydrated from the prod dump.
#    The fixtures cover 2 games; prod covers 17, with a different share format
#    each, so layering fixtures on top only muddies it. SEED_DEV_DATA=1 forces.
# ---------------------------------------------------------------------------
SEED_DEFAULT=1
if [ "$USE_REMOTE_DB" = "1" ] || [ "$HYDRATED_FROM_PROD" = "1" ]; then
  SEED_DEFAULT=0
fi
if [ "${SEED_DEV_DATA:-$SEED_DEFAULT}" = "1" ]; then
  log "seeding dev data"
  pnpm --filter @workshop/backend run db:seed
else
  log "skipping dev data seed (database already has prod-shaped data, or SEED_DEV_DATA=0)"
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
