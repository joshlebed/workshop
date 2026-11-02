#!/usr/bin/env bash
# Sourced by .niteshift/setup, .niteshift/resume and snapshot-prod.sh.
#
# The sandbox always runs against the local `postgres` service (docker,
# PG 17 to match prod, host networking). Any DATABASE_URL Niteshift injects
# (e.g. a Neon branch from the Database integration) is ignored on purpose:
# the local DB is seeded by copying prod wholesale (see
# workshop_snapshot_prod_into_local), which gives a realistic repro without
# per-task Neon branches.
#
# Exports DATABASE_URL (always the local URL).

WORKSHOP_LOCAL_DB_URL="postgres://postgres:postgres@localhost:5432/workshop"
WORKSHOP_PG_IMAGE="postgres:17"
WORKSHOP_PROD_DB_SSM_PARAM="/workshop-prod/db/url"

workshop_resolve_database_url() {
  DATABASE_URL="$WORKSHOP_LOCAL_DB_URL"
  export DATABASE_URL
}

# Start the manifest `postgres` service and block until it accepts
# connections (bounded, ~60s). `ns services start` returns when the process is
# up, not when the port is ready.
workshop_ensure_local_postgres() {
  ns services start postgres
  local i
  for i in $(seq 1 120); do
    if docker exec workshop-pg pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "postgres did not become ready in 60s" >&2
  ns services logs postgres -n 50 >&2 || true
  return 1
}

# Replace the local `workshop` database with a copy of prod.
# Reads the prod URL from SSM through the sandbox's assumed AWS role
# (infra/niteshift.tf). pg_dump/pg_restore run from the postgres:17 image so
# client and server major versions match. The dump is custom-format, data +
# schema, no owners/privileges (neondb_owner doesn't exist locally).
# Returns 1 (without touching the local DB) when prod isn't reachable.
workshop_snapshot_prod_into_local() {
  local prod_url dump
  prod_url="$(aws ssm get-parameter --name "$WORKSHOP_PROD_DB_SSM_PARAM" \
    --with-decryption --query Parameter.Value --output text 2>/dev/null)" || prod_url=""
  if [ -z "$prod_url" ] || [ "$prod_url" = "None" ]; then
    echo "prod DATABASE_URL not readable from SSM ($WORKSHOP_PROD_DB_SSM_PARAM)" >&2
    return 1
  fi
  dump="$(mktemp -d)/prod.dump"
  echo "dumping prod → $dump"
  docker run --rm --network=host -v "$(dirname "$dump"):/out" "$WORKSHOP_PG_IMAGE" \
    pg_dump --no-owner --no-privileges --format=custom --file=/out/prod.dump "$prod_url"
  echo "restoring into local workshop db"
  docker exec workshop-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS workshop WITH (FORCE);" -c "CREATE DATABASE workshop;"
  docker run --rm --network=host -v "$(dirname "$dump"):/out" "$WORKSHOP_PG_IMAGE" \
    pg_restore --no-owner --no-privileges --exit-on-error \
    --dbname="$WORKSHOP_LOCAL_DB_URL" /out/prod.dump
  rm -rf "$(dirname "$dump")"
  echo "local workshop db now mirrors prod"
}
