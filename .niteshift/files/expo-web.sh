#!/usr/bin/env bash
# Service wrapper for an Expo web dev server: `expo-web.sh <pnpm-filter>`.
# Used by the `web` (workshop-app, :8081) and `highscore` (highscore-app,
# :8082) services.
#
# Expo CLI's CorsMiddleware only whitelists `localhost` plus
# `expo.extra.router.origin`; the Niteshift preview proxy keeps the iframe
# `Origin: https://ns-<port>-<id>.preview.niteshift.dev`, so without the
# whitelist every POST from the preview bounces with a 401 HTML page before
# our /api dev proxy sees it. Each app's app.config.ts reads
# EXPO_DEV_SERVER_ALLOWED_ORIGIN; derive it for *this* service's port from
# NITESHIFT_PORT_<port>_URL (present on tasks started after the manifest was
# committed) or the preview URL template. Clear the legacy named-port variable
# so HighScore doesn't inherit Workshop's :8081 origin.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
# shellcheck disable=SC1091
source "$REPO_DIR/.niteshift/files/toolchain.sh"

filter="${1:?usage: expo-web.sh <pnpm-filter>}"
port="${PORT:?PORT is exported by the supervisor}"

unset NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL
port_var="NITESHIFT_PORT_${port}_URL"
origin="${!port_var:-}"
if [ -z "$origin" ] && [ -n "${NITESHIFT_PREVIEW_URL_TEMPLATE:-}" ]; then
  origin="${NITESHIFT_PREVIEW_URL_TEMPLATE//\{port\}/$port}"
fi
if [ -n "$origin" ]; then
  export EXPO_DEV_SERVER_ALLOWED_ORIGIN="$origin"
  echo "[expo-web] allowed preview origin: $origin"
fi

exec pnpm --filter "$filter" run web
