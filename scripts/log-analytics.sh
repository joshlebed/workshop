#!/usr/bin/env bash
# Run pre-built CloudWatch Logs Insights queries against the request log.
#
# Usage:
#   scripts/log-analytics.sh                            # default: by-platform, last 7d
#   scripts/log-analytics.sh by-user --since 24h
#   scripts/log-analytics.sh top-paths --since 30d
#   scripts/log-analytics.sh errors --since 1h
#   scripts/log-analytics.sh user <user-id> --since 7d  # one user's request stream
#   scripts/log-analytics.sh raw '<insights query>'     # arbitrary query
#
# Requires AWS_PROFILE=workshop-prod (or admin equivalent).
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
LOG_GROUP=${LOG_GROUP:-/aws/lambda/workshop-prod-api}

QUERY_NAME=${1:-by-platform}
shift || true

# Positional arg for `user <id>` / `raw <query>`
EXTRA=""
case "$QUERY_NAME" in
  user|raw)
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
      EXTRA="$1"; shift
    fi
    ;;
esac

SINCE="7d"
while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Convert "24h" / "7d" / "30m" to absolute seconds from now
unit="${SINCE: -1}"
amount="${SINCE%?}"
case "$unit" in
  s) secs=$amount ;;
  m) secs=$((amount * 60)) ;;
  h) secs=$((amount * 3600)) ;;
  d) secs=$((amount * 86400)) ;;
  *) echo "bad --since (try 30m, 24h, 7d): $SINCE" >&2; exit 1 ;;
esac
END_TS=$(date +%s)
START_TS=$((END_TS - secs))

case "$QUERY_NAME" in
  by-platform)
    QUERY='fields @timestamp, platform
| filter kind = "request"
| stats count() as requests, count_distinct(user_id) as users by platform
| sort requests desc'
    ;;
  by-user)
    QUERY='fields @timestamp, user_id
| filter kind = "request" and ispresent(user_id)
| stats count() as requests, count_distinct(path) as paths by user_id, platform
| sort requests desc
| limit 50'
    ;;
  top-paths)
    QUERY='fields @timestamp
| filter kind = "request"
| stats count() as hits, avg(duration_ms) as avg_ms, pct(duration_ms, 95) as p95_ms by route, method
| sort hits desc
| limit 50'
    ;;
  errors)
    QUERY='fields @timestamp, status, method, path, user_id, platform, request_id
| filter kind = "request" and status >= 500
| sort @timestamp desc
| limit 200'
    ;;
  status-codes)
    QUERY='fields @timestamp
| filter kind = "request"
| stats count() as hits by status, platform
| sort hits desc'
    ;;
  rps)
    QUERY='fields @timestamp
| filter kind = "request"
| stats count() as requests by bin(1h), platform
| sort @timestamp asc'
    ;;
  slow)
    QUERY='fields @timestamp, duration_ms, method, path, user_id, platform, status
| filter kind = "request" and duration_ms > 1000
| sort duration_ms desc
| limit 100'
    ;;
  user)
    if [ -z "$EXTRA" ]; then
      echo "usage: scripts/log-analytics.sh user <user-id> [--since 7d]" >&2; exit 1
    fi
    QUERY="fields @timestamp, method, path, status, duration_ms, platform, app_version, ip
| filter kind = \"request\" and user_id = \"$EXTRA\"
| sort @timestamp desc
| limit 500"
    ;;
  raw)
    if [ -z "$EXTRA" ]; then
      echo "usage: scripts/log-analytics.sh raw '<insights query>' [--since 7d]" >&2; exit 1
    fi
    QUERY="$EXTRA"
    ;;
  *)
    cat >&2 <<EOF
unknown query: $QUERY_NAME

available:
  by-platform   request + unique-user counts grouped by platform
  by-user       top users by request count
  top-paths     top routes by hits, with p95 latency
  errors        recent 5xx responses (status, path, user, request_id)
  status-codes  distribution of status codes by platform
  rps           hourly request volume by platform
  slow          requests slower than 1s
  user <id>     one user's full request stream
  raw '<q>'     arbitrary Logs Insights query
EOF
    exit 1
    ;;
esac

QUERY_ID=$(aws logs start-query \
  --region "$REGION" \
  --log-group-name "$LOG_GROUP" \
  --start-time "$START_TS" \
  --end-time "$END_TS" \
  --query-string "$QUERY" \
  --query queryId --output text)

echo "running '$QUERY_NAME' over $LOG_GROUP since $SINCE (query $QUERY_ID)..." >&2

while :; do
  STATUS=$(aws logs get-query-results --region "$REGION" --query-id "$QUERY_ID" --query status --output text)
  case "$STATUS" in
    Complete) break ;;
    Failed|Cancelled|Timeout|Unknown)
      echo "query $STATUS" >&2
      aws logs get-query-results --region "$REGION" --query-id "$QUERY_ID"
      exit 1
      ;;
    *) sleep 1 ;;
  esac
done

aws logs get-query-results --region "$REGION" --query-id "$QUERY_ID" --output json \
  | jq -r '
      (.results[0] // []) as $first
      | if ($first | length) == 0 then "no results" else
          (($first | map(.field)) | @tsv),
          (.results[]
            | (map(.value) | @tsv))
        end
    '
