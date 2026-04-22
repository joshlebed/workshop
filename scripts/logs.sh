#!/usr/bin/env bash
# Tail Lambda CloudWatch logs in production.
# Usage:
#   scripts/logs.sh                 # follow last 10min, live
#   scripts/logs.sh --since 1h      # follow last hour
#   scripts/logs.sh --filter error  # only lines matching "error"
#   scripts/logs.sh --no-follow     # print and exit
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
LOG_GROUP=${LOG_GROUP:-/aws/lambda/workshop-prod-api}

SINCE="10m"
FOLLOW=1
FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --since)      SINCE="$2"; shift 2 ;;
    --filter)     FILTER="$2"; shift 2 ;;
    --no-follow)  FOLLOW=0; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

ARGS=(logs tail "$LOG_GROUP" --since "$SINCE" --format short --region "$REGION")
if [ "$FOLLOW" = "1" ]; then
  ARGS+=(--follow)
fi
if [ -n "$FILTER" ]; then
  ARGS+=(--filter-pattern "$FILTER")
fi

exec aws "${ARGS[@]}"
