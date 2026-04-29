#!/usr/bin/env bash
# Manual fallback: bundle the Lambda and upload it. CI does this automatically
# on push to main — use this only if CI is broken or you need to test a fix
# before merging.
set -euo pipefail

cd "$(dirname "$0")/.."

REGION=${AWS_REGION:-us-east-1}
FUNCTION=${LAMBDA_NAME:-workshop-prod-api}

# Local-laptop default: if no auth is configured, assume SSO via workshop-prod.
# CI sets AWS_ACCESS_KEY_ID via OIDC; explicit AWS_PROFILE wins either way.
DEFAULTED_PROFILE=0
if [ -z "${AWS_PROFILE:-}" ] && [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  export AWS_PROFILE=workshop-prod
  DEFAULTED_PROFILE=1
fi

echo "→ Checking AWS credentials..."
if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
  echo "ERROR: AWS credentials missing or expired." >&2
  if [ "$DEFAULTED_PROFILE" = "1" ]; then
    echo "  Run: aws sso login --profile workshop-prod" >&2
  elif [ -n "${AWS_PROFILE:-}" ]; then
    echo "  Run: aws sso login --profile $AWS_PROFILE" >&2
  else
    echo "  Refresh AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN env vars." >&2
  fi
  exit 1
fi

echo "→ Building..."
pnpm --filter @workshop/backend run build

echo "→ Uploading to Lambda: $FUNCTION ($REGION)"
aws lambda update-function-code \
  --function-name "$FUNCTION" \
  --zip-file fileb://apps/backend/lambda.zip \
  --region "$REGION" \
  --publish

aws lambda wait function-updated \
  --function-name "$FUNCTION" \
  --region "$REGION"

echo "→ Done."
