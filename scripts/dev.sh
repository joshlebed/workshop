#!/usr/bin/env bash
# Start postgres (Docker) + backend + Expo web app, with namespaced log output
# via `concurrently`. Web runs at http://localhost:8081, backend at :8787.
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

LOG_FILE="${WORKSHOP_DEV_LOG:-/tmp/workshop-dev.log}"
: > "$LOG_FILE"

echo ""
echo "→ Starting backend (:8787) and web app (:8081). Ctrl-C stops both."
echo "  Logs tee'd to $LOG_FILE — \`tail -f $LOG_FILE\` to follow, or grep to search."
echo ""

lsof -ti:8081 | xargs kill 2>/dev/null || true

# Keep colors on the terminal (FORCE_COLOR=1 propagates through the pipe), but
# strip ANSI escapes from the tee'd file so grep / agents see plain text.
export FORCE_COLOR=1
exec pnpm exec concurrently \
  --names "backend,web" \
  --prefix-colors "cyan.bold,magenta.bold" \
  --kill-others-on-fail \
  "pnpm --filter @workshop/backend run dev" \
  "pnpm --filter workshop-app run web" 2>&1 \
  | tee >(perl -MIO::Handle -pe 'BEGIN { STDOUT->autoflush(1) } s/\e\[[0-9;?]*[a-zA-Z]//g' > "$LOG_FILE")
