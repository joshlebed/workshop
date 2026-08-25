#!/usr/bin/env bash
# Start postgres (Docker) + backend + Expo web app, with namespaced log output
# via `concurrently`. Web runs at http://localhost:8081, backend at :8787.
#
# `HIGHSCORE=1 pnpm dev` additionally starts the HighScore web app on :8082
# against the same backend. Off by default so the common Workshop loop keeps
# booting two processes instead of three; `pnpm dev:highscore` runs it alone.
#
# For native iOS (interactive QR UI), use `pnpm dev:mobile` in a separate
# terminal instead — `expo start` keybindings don't render cleanly when logs
# stream into the same TTY.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start Docker Desktop and retry."
  exit 1
fi

if ! docker ps -a --format '{{.Names}}' | grep -q '^workshop-pg$'; then
  echo "Creating postgres container..."
  docker run -d \
    --name workshop-pg \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=workshop \
    -p 5432:5432 \
    postgres:16 >/dev/null
else
  docker start workshop-pg >/dev/null
fi

printf "Waiting for postgres"
for _ in $(seq 1 20); do
  if docker exec workshop-pg pg_isready -U postgres >/dev/null 2>&1; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 0.5
done

if [ ! -f apps/backend/.env ]; then
  cp apps/backend/.env.example apps/backend/.env
  SECRET=$(openssl rand -hex 32)
  awk -v s="$SECRET" '
    /^SESSION_SECRET=/ { print "SESSION_SECRET=" s; next }
    { print }
  ' apps/backend/.env > apps/backend/.env.tmp && mv apps/backend/.env.tmp apps/backend/.env
  echo "Created apps/backend/.env (with a generated SESSION_SECRET)."
fi

set -a
# shellcheck disable=SC1091
source apps/backend/.env
set +a
pnpm --filter @workshop/backend run db:migrate

# Idempotent dev-data seed — populates `joshlebed@gmail.com` (matching the
# web app's auto-dev-sign-in user) on a fresh DB so the UI opens lived-in.
# `SEED_DEV_DATA=0 pnpm dev` skips it if you need to reproduce empty state.
if [ "${SEED_DEV_DATA:-1}" = "1" ]; then
  pnpm --filter @workshop/backend run db:seed
fi

LOG_FILE="${WORKSHOP_DEV_LOG:-/tmp/workshop-dev.log}"
: > "$LOG_FILE"

RUN_HIGHSCORE="${HIGHSCORE:-0}"

echo ""
if [ "$RUN_HIGHSCORE" = "1" ]; then
  echo "→ Starting backend (:8787), workshop web (:8081), highscore web (:8082). Ctrl-C stops all."
else
  echo "→ Starting backend (:8787) and web app (:8081). Ctrl-C stops both."
fi
echo "  Logs tee'd to $LOG_FILE — \`tail -f $LOG_FILE\` to follow, or grep to search."
echo ""

lsof -ti:8081 | xargs kill 2>/dev/null || true
if [ "$RUN_HIGHSCORE" = "1" ]; then
  lsof -ti:8082 | xargs kill 2>/dev/null || true
fi

# Keep colors on the terminal (FORCE_COLOR=1 propagates through the pipe), but
# strip ANSI escapes from the tee'd file so grep / agents see plain text.
export FORCE_COLOR=1
NAMES="backend,web"
COLORS="cyan.bold,magenta.bold"
PROCS=("pnpm --filter @workshop/backend run dev" "pnpm --filter workshop-app run web")
if [ "$RUN_HIGHSCORE" = "1" ]; then
  NAMES="$NAMES,highscore"
  COLORS="$COLORS,yellow.bold"
  PROCS+=("pnpm --filter highscore-app run web")
fi

exec pnpm exec concurrently \
  --names "$NAMES" \
  --prefix-colors "$COLORS" \
  --kill-others-on-fail \
  "${PROCS[@]}" 2>&1 \
  | tee >(perl -MIO::Handle -pe 'BEGIN { STDOUT->autoflush(1) } s/\e\[[0-9;?]*[a-zA-Z]//g' > "$LOG_FILE")
