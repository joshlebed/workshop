#!/usr/bin/env bash
# Prints `repeat=true` when this run continues a failure streak that has already
# been reported, else `repeat=false`. Never exits non-zero: a lookup problem must
# not swallow a real failure ping.
#
# Reads GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_NUMBER, GITHUB_RUN_ATTEMPT,
# GITHUB_REF_NAME and WORKFLOW. Cancelled and skipped runs say nothing about
# health, so the look-back ignores them.
set -uo pipefail

answer() {
  echo "repeat=$1"
  exit 0
}

# A manual re-run of a failed run: its earlier attempt already pinged.
if [ "${GITHUB_RUN_ATTEMPT:-1}" -gt 1 ]; then
  previous_attempt=$((GITHUB_RUN_ATTEMPT - 1))
  conclusion=$(gh api \
    "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$previous_attempt" \
    --jq '.conclusion' 2>/dev/null) || conclusion=""
  [ "$conclusion" = "failure" ] && answer true
fi

runs=$(gh api \
  "repos/$GITHUB_REPOSITORY/actions/workflows/$WORKFLOW/runs?branch=$GITHUB_REF_NAME&status=completed&per_page=50" \
  2>/dev/null) || answer false

previous=$(jq -r --argjson number "$GITHUB_RUN_NUMBER" '
  [.workflow_runs[]
    | select(.run_number < $number)
    | select(.conclusion == "success" or .conclusion == "failure")]
  | sort_by(.run_number)
  | last
  | .conclusion // ""
' <<<"$runs" 2>/dev/null) || answer false

[ "$previous" = "failure" ] && answer true
answer false
