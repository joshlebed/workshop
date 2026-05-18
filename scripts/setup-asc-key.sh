#!/usr/bin/env bash
# Interactive setup for the App Store Connect API key that testflight.yml
# uses to authenticate eas-cli with Apple non-interactively. Apple won't
# mint an ASC API key without a 2FA-protected Apple-ID session, so the
# .p8 generation happens in the browser; this script handles everything
# after that — encoding, gh secret writes, optional re-fire of the
# TestFlight workflow.
#
# Usage (from the repo root):
#
#   pnpm setup:asc-key
#
# Idempotent. Run again to rotate the key.

set -euo pipefail

REPO=${REPO:-joshlebed/workshop}
ASC_API_URL="https://appstoreconnect.apple.com/access/integrations/api"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

if ! command -v gh >/dev/null 2>&1; then
  red "gh CLI not found. Install: https://cli.github.com/"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  red "gh not authenticated. Run: gh auth login"
  exit 1
fi
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  red "Can't see $REPO via gh. Check auth scopes (need 'repo')."
  exit 1
fi

bold "Step 1 — Generate an App Store Connect API key"
echo
echo "  • Open:    $ASC_API_URL"
echo "             (if Apple has reorganized again, navigate manually:"
echo "              Users and Access → Integrations tab → App Store Connect API → Team Keys)"
echo "  • Team Keys → + → Name: 'Workshop CI' · Access: 'App Manager' → Generate"
echo "  • Download the .p8 (Apple won't show it again)"
echo "  • Note the Key ID (10 chars, in the row) and Issuer ID (UUID at top)"
echo

OPENER=""
case "$(uname -s)" in
  Darwin)  OPENER="open" ;;
  Linux)   command -v xdg-open >/dev/null 2>&1 && OPENER="xdg-open" ;;
esac
if [ -n "$OPENER" ]; then
  read -rp "Open $ASC_API_URL in your browser now? [Y/n] " yn
  if [[ ! "$yn" =~ ^[Nn] ]]; then
    "$OPENER" "$ASC_API_URL" >/dev/null 2>&1 || true
  fi
fi

echo
bold "Step 2 — Locate the downloaded .p8 file"
DOWNLOADS="${HOME}/Downloads"
GUESS=""
if compgen -G "${DOWNLOADS}/AuthKey_*.p8" >/dev/null 2>&1; then
  GUESS=$(ls -t "${DOWNLOADS}"/AuthKey_*.p8 2>/dev/null | head -1)
fi
if [ -n "$GUESS" ]; then
  read -rp "Path to .p8 [${GUESS}]: " P8_PATH
  P8_PATH="${P8_PATH:-$GUESS}"
else
  read -rp "Path to .p8 file: " P8_PATH
fi
P8_PATH="${P8_PATH/#\~/$HOME}"
if [ ! -f "$P8_PATH" ]; then
  red "File not found: $P8_PATH"
  exit 1
fi
if ! grep -q "BEGIN PRIVATE KEY" "$P8_PATH"; then
  red "$P8_PATH doesn't look like a .p8 (no BEGIN PRIVATE KEY marker)."
  exit 1
fi

# Apple names downloads AuthKey_<KEYID>.p8 — pre-fill from the filename.
FNAME=$(basename "$P8_PATH")
KEY_ID_GUESS=$(echo "$FNAME" | sed -n 's/^AuthKey_\([A-Z0-9]\{10\}\)\.p8$/\1/p' || true)

echo
bold "Step 3 — Key metadata"
if [ -n "$KEY_ID_GUESS" ]; then
  read -rp "Key ID [${KEY_ID_GUESS}]: " KEY_ID
  KEY_ID="${KEY_ID:-$KEY_ID_GUESS}"
else
  read -rp "Key ID (10 chars, alphanumeric): " KEY_ID
fi
if [[ ! "$KEY_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  red "Key ID '$KEY_ID' doesn't look right — should be 10 uppercase alphanumeric chars."
  exit 1
fi
read -rp "Issuer ID (UUID, found at the top of $ASC_API_URL): " ISSUER_ID
if [[ ! "$ISSUER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  red "Issuer ID '$ISSUER_ID' doesn't look like a UUID."
  exit 1
fi

# Run gh and capture combined output. When stdout isn't a TTY (because we're
# piping into command substitution), gh skips its TUI rendering — which
# otherwise queries the terminal for background color and cursor position,
# and on some terminals (Warp, recent iTerm) those responses leak back onto
# stdout as `\x1b]11;rgb:...\x1b\\` / `\x1b[<row>;<col>R` noise. We print
# our own success/failure line either way.
run_gh() {
  local label=$1
  shift
  local out
  if ! out=$("$@" 2>&1); then
    red "✗ $label failed:"
    echo "$out" >&2
    exit 1
  fi
}

echo
bold "Step 4 — Push secrets to $REPO"
# `gh secret set` reads from stdin when --body is omitted. We can't redirect
# stdin through `run_gh` cleanly, so handle the .p8 case inline.
if ! out=$(gh secret set ASC_API_KEY_CONTENT --repo "$REPO" < "$P8_PATH" 2>&1); then
  red "✗ ASC_API_KEY_CONTENT failed:"
  echo "$out" >&2
  exit 1
fi
green "✓ ASC_API_KEY_CONTENT"
run_gh ASC_API_KEY_ID    gh secret set ASC_API_KEY_ID    --repo "$REPO" --body "$KEY_ID"
green "✓ ASC_API_KEY_ID"
run_gh ASC_API_ISSUER_ID gh secret set ASC_API_ISSUER_ID --repo "$REPO" --body "$ISSUER_ID"
green "✓ ASC_API_ISSUER_ID"

echo
bold "Step 5 — Trigger a fresh TestFlight build"
read -rp "Fire 'gh workflow run testflight.yml --field force=true' now? [Y/n] " yn
if [[ ! "$yn" =~ ^[Nn] ]]; then
  run_gh "workflow run" \
    gh workflow run testflight.yml --ref main --field force=true --repo "$REPO"
  green "✓ Build queued. Monitor:"
  green "    https://github.com/$REPO/actions/workflows/testflight.yml"
else
  dim "Skipped. Trigger later with:"
  dim "    gh workflow run testflight.yml --ref main --field force=true"
fi

# The .p8 is now in GitHub Actions secrets; the local copy is no longer
# needed. Offer to delete it so it doesn't linger in Downloads.
if [[ "$P8_PATH" == "$DOWNLOADS"/* ]]; then
  echo
  read -rp "Delete $P8_PATH? (it's already in GH secrets) [Y/n] " yn
  if [[ ! "$yn" =~ ^[Nn] ]]; then
    rm -f "$P8_PATH"
    green "✓ Deleted $P8_PATH"
  fi
fi

echo
green "Done. Future bundle-id additions and capability toggles run in CI hands-off."
