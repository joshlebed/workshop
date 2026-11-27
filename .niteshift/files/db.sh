#!/usr/bin/env bash
# Sourced by .niteshift/setup, .niteshift/resume and snapshot-prod.sh.
#
# The sandbox always runs against the local `postgres` service (docker,
# PG 17 to match prod, host networking). Any DATABASE_URL Niteshift injects
# (e.g. a Neon branch from the Database integration) is ignored on purpose:
# the local DB is seeded by copying prod with synthetic push tokens (see
# workshop_snapshot_prod_into_local), which gives a realistic repro without
# per-task Neon branches.
#
# Exports DATABASE_URL (always the local URL).

WORKSHOP_LOCAL_DB_URL="postgres://postgres:postgres@localhost:5432/workshop"
WORKSHOP_PG_IMAGE="postgres:17"
WORKSHOP_PROD_DB_SSM_PARAM="/workshop-prod/db/url"
# Buckets from infra/images.tf, named `<prefix>-<purpose>-<account id>`.
WORKSHOP_BUCKET_PREFIX="workshop-prod"
# A cached dump younger than this is reused instead of dumping prod again.
WORKSHOP_SNAPSHOT_MAX_AGE_SECONDS=$((24 * 60 * 60))
# The legacy prod.dump can contain live push tokens. Never read or refresh it.
WORKSHOP_SNAPSHOT_KEY="prod-sanitized-v1.dump"
# Where the backend's local image driver reads and writes (IMAGE_STORAGE_DIR
# default, relative to apps/backend).
WORKSHOP_LOCAL_IMAGE_DIR="apps/backend/.data/images"

workshop_bucket() {
  local account
  account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || return 1
  [ -n "$account" ] && [ "$account" != "None" ] || return 1
  printf '%s-%s-%s' "$WORKSHOP_BUCKET_PREFIX" "$1" "$account"
}

# Download the cached prod dump into $1 when one exists and is fresh.
# Returns 1 (and leaves no file) otherwise. SNAPSHOT_FRESH=1 skips the cache.
workshop_fetch_cached_dump() {
  local dump="$1" bucket modified age
  [ "${SNAPSHOT_FRESH:-0}" = "1" ] && return 1
  bucket="$(workshop_bucket dev-snapshots)" || return 1
  modified="$(aws s3api head-object --bucket "$bucket" --key "$WORKSHOP_SNAPSHOT_KEY" \
    --query LastModified --output text 2>/dev/null)" || return 1
  age=$(($(date +%s) - $(date -d "$modified" +%s)))
  if [ "$age" -gt "$WORKSHOP_SNAPSHOT_MAX_AGE_SECONDS" ]; then
    echo "cached prod dump is $((age / 3600))h old; taking a fresh one"
    return 1
  fi
  if aws s3 cp "s3://$bucket/$WORKSHOP_SNAPSHOT_KEY" "$dump" --only-show-errors &&
    docker run --rm -v "$(dirname "$dump"):/out" "$WORKSHOP_PG_IMAGE" \
      pg_restore --list "/out/$(basename "$dump")" >/dev/null; then
    echo "using cached prod dump ($((age / 60))m old, no load on prod)"
    return 0
  fi
  rm -f "$dump"
  return 1
}

# Copy prod's uploaded images (profile pictures, list covers) into the local
# image directory, so the prod copy's rows have their pictures. Best effort:
# without it those rows show initials, and local uploads still work.
workshop_sync_prod_images() {
  local bucket
  bucket="$(workshop_bucket images)" || {
    echo "no AWS identity; skipping image sync" >&2
    return 0
  }
  mkdir -p "$WORKSHOP_LOCAL_IMAGE_DIR"
  if aws s3 sync "s3://$bucket" "$WORKSHOP_LOCAL_IMAGE_DIR" --exclude "state/*" \
    --only-show-errors 2>/dev/null; then
    echo "local image directory mirrors s3://$bucket"
  else
    echo "image sync from s3://$bucket failed; prod rows will show initials" >&2
  fi
}

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
#
# The dump comes from the shared cache in S3 when one was taken in the last
# 24h, so most sandboxes never touch prod: every dump used to be read out of
# Neon, and ~90 a month was a fifth of its network transfer allowance. The
# first sandbox past the 24h mark dumps prod and refreshes the cache.
# SNAPSHOT_FRESH=1 forces a new dump.
#
# pg_dump/pg_restore run from the postgres:17 image so client and server major
# versions match. The dump is custom-format, data + schema, no
# owners/privileges (neondb_owner doesn't exist locally), and leaves out
# `rate_limits` rows (per-request counters, ~1 MB, no use
# locally). Returns 1 (without touching the local DB) when no dump is to be had.
workshop_snapshot_prod_into_local() (
  local dir dump
  umask 077
  dir="$(mktemp -d)" || return 1
  trap 'rm -rf -- "$dir"' EXIT
  dump="$dir/prod.dump"
  if ! workshop_fetch_cached_dump "$dump" && ! workshop_dump_prod "$dir"; then
    return 1
  fi
  workshop_restore_dump "$dir"
)

# Only update the local cluster. Existing sandboxes may predate push_tokens
# (or be empty before setup runs migrations), so only that path allows absence.
workshop_scrub_push_tokens() {
  local database="${1:-workshop}" allow_missing="${2:-true}"
  docker exec -i workshop-pg psql -X -U postgres -d "$database" -q \
    -v ON_ERROR_STOP=1 -v allow_missing="$allow_missing" <<'SQL'
\if :allow_missing
SELECT to_regclass('public.push_tokens') IS NOT NULL AS has_push_tokens \gset
\if :has_push_tokens
\else
\quit
\endif
\endif
UPDATE public.push_tokens
SET expo_push_token = 'sandbox:' || encode(sha256(convert_to(expo_push_token, 'UTF8')), 'hex')
WHERE expo_push_token !~ '^sandbox:[0-9a-f]{64}$';
SQL
}

# Restore the raw dump into a scratch database, scrub it, then export the
# sanitized archive. The scratch database is never used by the backend.
workshop_sanitize_dump() (
  local dir="$1" scratch_db="workshop_snapshot_${BASHPID}_${RANDOM}"
  docker exec workshop-pg createdb -U postgres "$scratch_db" || return 1
  trap 'docker exec workshop-pg dropdb -U postgres "$scratch_db"' EXIT

  # pg_restore errors can contain COPY data. Keep them out of setup logs.
  if ! docker exec -i workshop-pg pg_restore -U postgres -d "$scratch_db" \
    --no-owner --no-privileges --exit-on-error < "$dir/raw.dump" 2>/dev/null; then
    echo "could not restore raw dump into scratch database" >&2
    return 1
  fi
  rm -f -- "$dir/raw.dump" || return 1
  workshop_scrub_push_tokens "$scratch_db" false || return 1
  docker exec workshop-pg pg_dump -U postgres -d "$scratch_db" \
    --no-owner --no-privileges --format=custom > "$dir/prod.dump" || return 1

  docker exec workshop-pg dropdb -U postgres "$scratch_db" || return 1
  trap - EXIT
)

# Dump prod, sanitize the archive, and refresh the shared cache.
workshop_dump_prod() {
  local dir="$1" prod_url dump bucket
  prod_url="$(aws ssm get-parameter --name "$WORKSHOP_PROD_DB_SSM_PARAM" \
    --with-decryption --query Parameter.Value --output text 2>/dev/null)" || prod_url=""
  if [ -z "$prod_url" ] || [ "$prod_url" = "None" ]; then
    echo "prod DATABASE_URL not readable from SSM ($WORKSHOP_PROD_DB_SSM_PARAM)" >&2
    return 1
  fi
  # Every step checks its own status: callers run this as `if fn; then`, which
  # disables `set -e` inside the function, so a failed dump used to fall
  # through, drop the local DB, and still report success (empty sandbox DB).
  # The dump is taken (with retries — Neon occasionally resets the TLS stream
  # mid-COPY) before the local DB is touched.
  local attempt
  dump="$dir/prod.dump"
  for attempt in 1 2 3; do
    echo "dumping prod (attempt $attempt)"
    if docker run --rm --network=host -v "$dir:/out" "$WORKSHOP_PG_IMAGE" \
      pg_dump --no-owner --no-privileges --format=custom \
      --exclude-table-data=rate_limits --file=/out/raw.dump "$prod_url" &&
      docker run --rm -v "$dir:/out" "$WORKSHOP_PG_IMAGE" \
        pg_restore --list /out/raw.dump >/dev/null; then
      break
    fi
    if [ "$attempt" = 3 ]; then
      echo "pg_dump failed 3 times; local DB left untouched" >&2
      return 1
    fi
    sleep 5
  done
  if ! workshop_sanitize_dump "$dir"; then
    echo "snapshot sanitization failed; local workshop DB and cache left untouched" >&2
    return 1
  fi
  # Share it. Best effort: the bucket may not exist yet, and a sandbox that
  # cannot upload still has its own dump.
  if bucket="$(workshop_bucket dev-snapshots)" &&
    aws s3 cp "$dump" "s3://$bucket/$WORKSHOP_SNAPSHOT_KEY" --only-show-errors 2>/dev/null; then
    echo "cached the dump for other sandboxes"
  fi
}

# Restore the sanitized $1/prod.dump over the local `workshop` database.
workshop_restore_dump() {
  local dir="$1"
  echo "restoring into local workshop db"
  docker exec workshop-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS workshop WITH (FORCE);" -c "CREATE DATABASE workshop;" || return 1
  if ! docker run --rm --network=host -v "$dir:/out" "$WORKSHOP_PG_IMAGE" \
    pg_restore --no-owner --no-privileges --exit-on-error \
    --dbname="$WORKSHOP_LOCAL_DB_URL" /out/prod.dump; then
    echo "pg_restore failed; local DB is partial — re-run .niteshift/files/snapshot-prod.sh" >&2
    return 1
  fi
  echo "local workshop db now has a sanitized prod snapshot"
}
