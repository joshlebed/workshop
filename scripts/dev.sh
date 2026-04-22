#!/usr/bin/env bash
# Full local dev stack: Docker postgres + backend + Expo.
# Run from repo root. Ctrl-C stops everything.
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Postgres via Docker
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

# Wait for postgres
printf "Waiting for postgres"
for _ in $(seq 1 20); do
  if docker exec workshop-pg pg_isready -U postgres >/dev/null 2>&1; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 0.5
done

# 2. Ensure .env exists
if [ ! -f apps/backend/.env ]; then
  cp apps/backend/.env.example apps/backend/.env
  SECRET=$(openssl rand -hex 32)
  awk -v s="$SECRET" '
    /^SESSION_SECRET=/ { print "SESSION_SECRET=" s; next }
    { print }
  ' apps/backend/.env > apps/backend/.env.tmp && mv apps/backend/.env.tmp apps/backend/.env
  echo "Created apps/backend/.env (with a generated SESSION_SECRET)."
fi

# 3. Apply migrations
set -a
# shellcheck disable=SC1091
source apps/backend/.env
set +a
pnpm --filter @workshop/backend run db:migrate

# 4. Start backend + mobile in parallel
trap 'echo "Stopping..."; kill 0' EXIT INT TERM

pnpm --filter @workshop/backend run dev &
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter watchlist run start &

wait
