#!/usr/bin/env bash
# Builds, signs and uploads ONE iOS app to TestFlight (macOS runner only). Signing is Apple's cloud-managed automatic signing, authorised by an App Store
# Connect API key: no certificate or provisioning profile is stored anywhere. The key file exists only inside RUNNER_TEMP for this run and is removed on exit.
# Inputs (environment): IOS_ASC_KEY_P8_BASE64 (secret), IOS_ASC_KEY_ID, IOS_ASC_ISSUER_ID, IOS_TEAM_ID (public identifiers), APP_VERSION_NAME, APP_VERSION_CODE,
# API_BASE_URL, APP_ID, SOURCE_SHA, DEVICE_ENVIRONMENT. Nothing is printed except step names; the key is never echoed.
# Usage: mobile/tool/ios-testflight.sh <food|ship>
set -euo pipefail
app="${1:-}"
case "$app" in food|ship) ;; *) echo "usage: $0 <food|ship>" >&2; exit 2 ;; esac
for v in IOS_ASC_KEY_P8_BASE64 IOS_ASC_KEY_ID IOS_ASC_ISSUER_ID IOS_TEAM_ID APP_VERSION_NAME APP_VERSION_CODE API_BASE_URL APP_ID SOURCE_SHA DEVICE_ENVIRONMENT RUNNER_TEMP; do
  [ -n "${!v:-}" ] || { echo "missing: $v" >&2; exit 1; }
done
printf '%s' "$IOS_ASC_KEY_ID" | grep -Eq '^[A-Z0-9]{10}$' || { echo "IOS_ASC_KEY_ID must be 10 letters/digits" >&2; exit 1; }
printf '%s' "$IOS_ASC_ISSUER_ID" | grep -Eq '^[0-9a-fA-F-]{36}$' || { echo "IOS_ASC_ISSUER_ID must be a UUID" >&2; exit 1; }
printf '%s' "$IOS_TEAM_ID" | grep -Eq '^[A-Z0-9]{10}$' || { echo "IOS_TEAM_ID must be 10 letters/digits" >&2; exit 1; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$RUNNER_TEMP/ios-release"
key="$work/AuthKey_${IOS_ASC_KEY_ID}.p8"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT
umask 077
printf '%s' "$IOS_ASC_KEY_P8_BASE64" | base64 --decode > "$key"
grep -q 'BEGIN PRIVATE KEY' "$key" || { echo "the API key is not a valid .p8" >&2; exit 1; }
auth=(-allowProvisioningUpdates -authenticationKeyPath "$key" -authenticationKeyID "$IOS_ASC_KEY_ID" -authenticationKeyIssuerID "$IOS_ASC_ISSUER_ID")

cd "$root/mobile/$app"
flutter build ios --release --no-codesign \
  --build-name="$APP_VERSION_NAME" --build-number="$APP_VERSION_CODE" \
  --dart-define=M14_OFFLINE_MAP=true \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=APP_ID="$APP_ID" \
  --dart-define=APP_VERSION="$APP_VERSION_NAME" \
  --dart-define=BUILD_NUMBER="$APP_VERSION_CODE" \
  --dart-define=CI_RUN="${GITHUB_RUN_ID:-0}" \
  --dart-define=SOURCE_SHA="$SOURCE_SHA" \
  --dart-define=BUILT_AT="$(date -u +%Y-%m-%dT%H:%MZ)" \
  --dart-define=SIGNING_MODE="stable" \
  --dart-define=DEVICE_ENVIRONMENT="$DEVICE_ENVIRONMENT"

cd ios
xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$work/Runner.xcarchive" \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  "${auth[@]}" archive

cat > "$work/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$IOS_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$work/Runner.xcarchive" -exportOptionsPlist "$work/ExportOptions.plist" \
  -exportPath "$work/export" "${auth[@]}"
echo "TestFlight upload finished for $APP_ID $APP_VERSION_NAME ($APP_VERSION_CODE)"
