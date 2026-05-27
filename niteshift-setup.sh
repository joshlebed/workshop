#!/usr/bin/env bash
# Niteshift setup for joshlebed/workshop
# - If the sandbox has a remote DATABASE_URL injected (e.g. a Neon branch from
#   Niteshift's database-branches integration), use it directly and skip the
#   local docker postgres. Otherwise start PostgreSQL 16 in a docker container
#   using host networking (Niteshift DinD bridge networking is broken, so
#   --network=host is required).
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
# 2) Start Postgres 16 (idempotent, host networking) — unless Niteshift has
#    already injected a remote DATABASE_URL (e.g. a Neon branch from the
#    database-branches integration). The injected URL takes precedence; a
#    localhost-shaped value means we're running standalone and need docker.
# ---------------------------------------------------------------------------
PG_CONTAINER="workshop-pg"
USE_REMOTE_DB=0
case "${DATABASE_URL:-}" in
  ""|*localhost*|*127.0.0.1*) USE_REMOTE_DB=0 ;;
  *) USE_REMOTE_DB=1 ;;
esac

if [ "$USE_REMOTE_DB" = "1" ]; then
  log "remote DATABASE_URL detected — skipping local postgres container"
else
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

  # No injected DATABASE_URL — fall back to the local docker container.
  : "${DATABASE_URL:=postgres://postgres:postgres@localhost:5432/workshop}"
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
#    Default off when running against a remote DB (e.g. a Neon branch forked
#    from prod) — the branch already has real-shaped data, and adding the
#    preview-user fixtures on top would muddy it. Set SEED_DEV_DATA=1 to force.
# ---------------------------------------------------------------------------
SEED_DEFAULT=1
if [ "$USE_REMOTE_DB" = "1" ]; then
  SEED_DEFAULT=0
fi
if [ "${SEED_DEV_DATA:-$SEED_DEFAULT}" = "1" ]; then
  log "seeding dev data"
  pnpm --filter @workshop/backend run db:seed
else
  log "skipping dev data seed (remote DB or SEED_DEV_DATA=0)"
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
