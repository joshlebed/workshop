#!/usr/bin/env bash
# Manual fallback: bundle the Lambda and upload it. CI does this automatically
# on push to main — use this only if CI is broken or you need to test a fix
# before merging.
set -euo pipefail

cd "$(dirname "$0")/.."

REGION=${AWS_REGION:-us-east-1}
FUNCTION=${LAMBDA_NAME:-workshop-prod-api}

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
