#!/usr/bin/env bash
# Sourced by .niteshift/setup and .niteshift/resume.
#
# Two database shapes, decided by the DATABASE_URL Niteshift hands setup:
#   * remote — the repo's Niteshift Database integration injects a per-task
#     Neon branch (non-localhost host). Use it as-is; no container.
#   * local  — DATABASE_URL is unset or localhost-shaped. Start the declared
#     `postgres` service (docker, host networking) and wait for it.
#
# Sets WORKSHOP_LOCAL_DB=0|1 and exports the resolved DATABASE_URL.

WORKSHOP_LOCAL_DB_URL="postgres://postgres:postgres@localhost:5432/workshop"

workshop_resolve_database_url() {
  case "${DATABASE_URL:-}" in
    ""|*localhost*|*127.0.0.1*) WORKSHOP_LOCAL_DB=1 ;;
    *) WORKSHOP_LOCAL_DB=0 ;;
  esac
  if [ "$WORKSHOP_LOCAL_DB" = "1" ]; then
    : "${DATABASE_URL:=$WORKSHOP_LOCAL_DB_URL}"
  fi
  export DATABASE_URL WORKSHOP_LOCAL_DB
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
