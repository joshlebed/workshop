#!/usr/bin/env bash
# Zero-external-infra iOS deploy: expo prebuild → xcodebuild archive →
# -exportArchive → xcrun altool. Uses your local Xcode signing setup
# (login.keychain dist cert + provisioning profile), no EAS Build.
#
# One-time prereqs:
#   1. Apple distribution cert in login.keychain. Plant it via:
#        npx eas-cli credentials -p ios     # downloads + installs
#      or export the .p12 from developer.apple.com → Certificates and
#      double-click to install into login.keychain.
#   2. App-specific password from appleid.apple.com → Sign-In and Security
#      → App-Specific Passwords. Then either:
#        export ASC_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
#      or store in keychain once and reference:
#        xcrun altool --store-password-in-keychain-item ASC_PASSWORD \
#          -u joshlebed@gmail.com -p '<password>'
#        export ASC_APP_SPECIFIC_PASSWORD='@keychain:ASC_PASSWORD'
#   3. Signed into your Apple ID in Xcode (Settings → Accounts) so
#      `-allowProvisioningUpdates` can fetch profiles.

set -euo pipefail

APPLE_ID="joshlebed@gmail.com"
TEAM_ID="Q65U6C65ZZ"
SCHEME="Workshopdev"

# Preflight — collect all missing prereqs and print one report. Better DX than
# fail → fix → fail → fix one at a time. See docs/manual-setup.md §12 for the
# canonical setup runbook.
missing=()

if ! command -v xcodebuild >/dev/null 2>&1; then
  missing+=("xcodebuild not found — install Xcode from the App Store, then run \`sudo xcode-select --install\`")
fi
if ! command -v pod >/dev/null 2>&1; then
  missing+=("CocoaPods not found — \`gem install cocoapods\` (or \`brew install cocoapods\`)")
fi
if ! command -v xcrun >/dev/null 2>&1; then
  missing+=("xcrun not found — Xcode command-line tools missing")
fi

if [ -z "${ASC_APP_SPECIFIC_PASSWORD:-}" ]; then
  missing+=("ASC_APP_SPECIFIC_PASSWORD env var not set
      Generate one at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords.
      Then either:
        export ASC_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
      or store once in keychain and reference:
        xcrun altool --store-password-in-keychain-item ASC_PASSWORD \\
          -u $APPLE_ID -p '<password>'
        export ASC_APP_SPECIFIC_PASSWORD='@keychain:ASC_PASSWORD'")
fi

if ! security find-identity -v -p codesigning 2>/dev/null \
    | grep -qE "(iPhone|Apple) Distribution.*\($TEAM_ID\)"; then
  missing+=("Apple distribution cert for team $TEAM_ID not found in any keychain
      Plant it once via either:
        cd apps/workshop && npx eas-cli@latest credentials -p ios
          (downloads EAS-managed cert + installs into login.keychain)
      or export the .p12 from https://developer.apple.com/account/resources/certificates
      and double-click to install.")
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "✘ Missing prereqs (${#missing[@]}):"
  echo
  for i in "${!missing[@]}"; do
    printf "  %d) %s\n\n" "$((i + 1))" "${missing[$i]}"
  done
  echo "After fixing, re-run: pnpm run deploy:ios:local"
  echo "Full setup guide: docs/manual-setup.md §12"
  exit 1
fi

echo "✓ Preflight checks passed"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/workshop"
BUILD_DIR="$APP_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/workshop.xcarchive"
EXPORT_OPTIONS="$BUILD_DIR/exportOptions.plist"

# App Store requires monotonically-increasing unique buildNumber per upload.
# Timestamp is collision-free without coordinating with EAS's `appVersionSource: remote`.
BUILD_NUMBER=$(date +%Y%m%d%H%M)

echo "→ Cleaning previous build artifacts"
rm -rf "$BUILD_DIR" "$APP_DIR/ios"
mkdir -p "$BUILD_DIR"

echo "→ expo prebuild (regenerates apps/workshop/ios)"
cd "$APP_DIR"
npx expo prebuild --platform ios --clean

echo "→ pod install"
cd ios
pod install

echo "→ xcodebuild archive (build #$BUILD_NUMBER)"
xcodebuild \
  -workspace "$SCHEME.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

echo "→ Generating exportOptions.plist"
cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>uploadBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
EOF

echo "→ xcodebuild -exportArchive (IPA → $BUILD_DIR)"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$BUILD_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

# IPA name comes from the app's product name (which contains a dot:
# "Workshop.dev"), so glob rather than hardcode.
IPA_PATH="$(find "$BUILD_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
if [ -z "$IPA_PATH" ] || [ ! -f "$IPA_PATH" ]; then
  echo "ERROR: no .ipa found in $BUILD_DIR"
  exit 1
fi

echo "→ Uploading $IPA_PATH to App Store Connect via altool"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --username "$APPLE_ID" \
  --password "$ASC_APP_SPECIFIC_PASSWORD"

echo "✓ Uploaded build #$BUILD_NUMBER. TestFlight processing takes ~10 min."
