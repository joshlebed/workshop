#!/usr/bin/env bash
# Legacy game-list usage audit (CloudWatch Logs Insights side).
#
# Reports legacy leaderboard-list traffic by operation, platform, app_version,
# and list_id so cleanup is driven by prod evidence, not code intent. Pairs with
# the DB-invariant audit in `apps/backend/scripts/legacy-games-db-audit.ts`.
#
# The two structured events (emitted by apps/backend/src/lib/legacyGameLists.ts,
# shipped in PR #343 on 2026-06-12):
#   legacy_game_list_access            – an authorized legacy read/write still
#                                        served through the compatibility bridge
#                                        (detail/read/items/views, public
#                                        preview/by-slug, item score read/upsert/
#                                        delete, list_scores)
#   legacy_game_list_retired_rejected  – a stale client trying to create / enable
#                                        a retired config (create/duplicate/
#                                        update_config/config_preview) — 400ed
#
# "Safe to start deleting" == both events report zero over a comfortable window.
#
# Usage:
#   scripts/legacy-games-audit.sh                       # summary, last 7d
#   scripts/legacy-games-audit.sh all --since 14d       # every report
#   scripts/legacy-games-audit.sh by-platform --since 30d
#   scripts/legacy-games-audit.sh by-list
#   scripts/legacy-games-audit.sh routes --since 7d     # raw request-log cross-check
#
# Reports: summary | by-operation | by-platform | by-list | rejected |
#          score-backend | samples | routes | all
#
# Requires AWS creds for the prod account (Niteshift sandbox role, or
# AWS_PROFILE=workshop-prod). Read-only (StartQuery / GetQueryResults).
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
LOG_GROUP=${LOG_GROUP:-/aws/lambda/workshop-prod-api}

REPORT=${1:-summary}
shift || true

SINCE="7d"
while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

unit="${SINCE: -1}"
amount="${SINCE%?}"
case "$unit" in
  m) secs=$((amount * 60)) ;;
  h) secs=$((amount * 3600)) ;;
  d) secs=$((amount * 86400)) ;;
  *) echo "bad --since (try 30m, 24h, 7d, 30d): $SINCE" >&2; exit 1 ;;
esac
END_TS=$(date +%s)
START_TS=$((END_TS - secs))

run_query() {
  local label="$1" query="$2"
  echo ""
  echo "===== ${label}  (over ${LOG_GROUP} since ${SINCE}) ====="
  local qid
  qid=$(aws logs start-query \
    --region "$REGION" \
    --log-group-name "$LOG_GROUP" \
    --start-time "$START_TS" \
    --end-time "$END_TS" \
    --query-string "$query" \
    --query queryId --output text)
  while :; do
    local status
    status=$(aws logs get-query-results --region "$REGION" --query-id "$qid" --query status --output text)
    case "$status" in
      Complete) break ;;
      Failed|Cancelled|Timeout|Unknown)
        echo "query $status" >&2
        aws logs get-query-results --region "$REGION" --query-id "$qid" >&2
        return 1 ;;
      *) sleep 1 ;;
    esac
  done
  aws logs get-query-results --region "$REGION" --query-id "$qid" --output json \
    | jq -r '
        (.results[0] // []) as $first
        | if ($first | length) == 0 then "  ✅ no results (zero legacy usage in window)" else
            (($first | map(.field)) | @tsv),
            (.results[] | (map(.value) | @tsv))
          end'
}

Q_SUMMARY='filter kind = "legacy_game_list_access" or kind = "legacy_game_list_retired_rejected"
| stats count() as hits by kind, operation, status
| sort hits desc'

Q_BY_OPERATION='filter kind = "legacy_game_list_access"
| stats count() as hits, count_distinct(user_id) as users, count_distinct(list_id) as lists by operation
| sort hits desc'

Q_BY_PLATFORM='filter kind = "legacy_game_list_access" or kind = "legacy_game_list_retired_rejected"
| stats count() as hits by kind, platform, app_version
| sort hits desc
| limit 100'

Q_BY_LIST='filter kind = "legacy_game_list_access"
| stats count() as hits, count_distinct(user_id) as users by list_id, operation
| sort hits desc
| limit 100'

Q_REJECTED='filter kind = "legacy_game_list_retired_rejected"
| stats count() as hits by operation, platform, app_version, proposed_modules, proposed_item_kind
| sort hits desc
| limit 100'

Q_SCORE_BACKEND='filter kind = "legacy_game_list_access"
| stats count() as hits by score_backend, operation
| sort hits desc'

Q_SAMPLES='fields @timestamp, kind, operation, status, platform, app_version, user_id, list_id, item_id, score_backend, request_id
| filter kind = "legacy_game_list_access" or kind = "legacy_game_list_retired_rejected"
| sort @timestamp desc
| limit 100'

# Complementary cross-check: raw request log for the legacy route shapes. Catches
# any traffic to the old surfaces even if the legacy detector did not fire (e.g.
# a list that is no longer flagged legacy). Should match the structured events.
Q_ROUTES='fields @timestamp
| filter kind = "request" and (route like "/scores" or route like "by-slug" or route like "/preview")
| stats count() as hits, count_distinct(user_id) as users by route, method
| sort hits desc
| limit 100'

case "$REPORT" in
  summary)        run_query "SUMMARY (both events by operation/status)" "$Q_SUMMARY" ;;
  by-operation)   run_query "ACCESS by operation" "$Q_BY_OPERATION" ;;
  by-platform)    run_query "BOTH events by platform/app_version" "$Q_BY_PLATFORM" ;;
  by-list)        run_query "ACCESS by list_id/operation" "$Q_BY_LIST" ;;
  rejected)       run_query "RETIRED-REJECTED stale-client writes" "$Q_REJECTED" ;;
  score-backend)  run_query "ACCESS by score backend (item_scores vs game_scores)" "$Q_SCORE_BACKEND" ;;
  samples)        run_query "RAW legacy event samples" "$Q_SAMPLES" ;;
  routes)         run_query "REQUEST-LOG cross-check (legacy route shapes)" "$Q_ROUTES" ;;
  all)
    run_query "SUMMARY (both events by operation/status)" "$Q_SUMMARY"
    run_query "ACCESS by operation" "$Q_BY_OPERATION"
    run_query "BOTH events by platform/app_version" "$Q_BY_PLATFORM"
    run_query "ACCESS by list_id/operation" "$Q_BY_LIST"
    run_query "RETIRED-REJECTED stale-client writes" "$Q_REJECTED"
    run_query "ACCESS by score backend (item_scores vs game_scores)" "$Q_SCORE_BACKEND"
    run_query "REQUEST-LOG cross-check (legacy route shapes)" "$Q_ROUTES"
    run_query "RAW legacy event samples" "$Q_SAMPLES"
    ;;
  *)
    echo "unknown report: $REPORT" >&2
    echo "reports: summary | by-operation | by-platform | by-list | rejected | score-backend | samples | routes | all" >&2
    exit 1 ;;
esac
