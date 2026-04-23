#!/usr/bin/env bash
# Open a psql shell against the production Postgres (Neon), pulling the
# connection string from SSM.
# Requires: aws CLI configured, psql installed.
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
PARAM=${DB_URL_PARAM:-/workshop-prod/db/url}

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install postgresql client: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

DB_URL=$(aws ssm get-parameter \
  --name "$PARAM" \
  --with-decryption \
  --region "$REGION" \
  --query Parameter.Value \
  --output text)

echo "Connecting to prod Postgres (Neon). Be careful."
exec psql "$DB_URL"
