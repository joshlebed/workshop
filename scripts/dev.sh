#!/usr/bin/env bash
# Start postgres (Docker) + backend. Run Expo separately in another terminal:
#
#   EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter watchlist start
#
# Why two terminals: Expo's interactive QR/keybind UI doesn't render cleanly
# if backend logs are streaming into the same TTY.
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

echo ""
echo "→ Backend starting. In another terminal, run:"
echo "  EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter watchlist start"
echo ""

exec pnpm --filter @workshop/backend run dev
