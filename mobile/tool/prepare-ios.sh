#!/usr/bin/env bash
# Builds the iOS project of one app (macOS only): `flutter create --platforms ios` (so it always matches the installed Flutter), then the Info.plist keys
# this app needs. The generated ios/ folder is not committed. All native code lives in the committed plugin mobile/packages/n11_native_ios, which Flutter
# registers by itself (no AppDelegate edits). Bundle ids equal the Android applicationIds (vn.eleven.food / vn.eleven.ship).
# Usage: mobile/tool/prepare-ios.sh <food|ship>
set -euo pipefail

app="${1:-}"
case "$app" in
  food) label="11Food"; app_id="vn.eleven.food"
        location_text="11Food dùng vị trí hiện tại của bạn để chọn địa chỉ giao hàng và tìm quán gần bạn."
        camera_text="11Food cần camera để chụp ảnh gửi kèm (ví dụ ảnh quán hoặc món)."
        photos_text="11Food cần truy cập ảnh để bạn chọn ảnh gửi kèm." ;;
  ship) label="11Ship"; app_id="vn.eleven.ship"
        location_text="11Ship dùng vị trí hiện tại của bạn để chọn điểm đón, điểm giao và, khi bạn bật nhận đơn, chia sẻ vị trí của bạn với hệ thống để nhận đơn gần bạn, kể cả khi ứng dụng chạy nền."
        camera_text="11Ship cần camera để chụp ảnh gửi kèm (ví dụ ảnh giấy tờ hoặc kiện hàng)."
        photos_text="11Ship cần truy cập ảnh để bạn chọn ảnh gửi kèm." ;;
  *) echo "usage: $0 <food|ship>" >&2; exit 2 ;;
esac
if [ ! -x /usr/libexec/PlistBuddy ]; then
  echo "prepare-ios.sh needs macOS (PlistBuddy)" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
dest="$root/$app/ios"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

rm -rf "$dest"
(cd "$tmp" && flutter create --project-name "$app" --org vn.eleven --platforms ios --empty "$app" >/dev/null)
cp -R "$tmp/$app/ios" "$dest"
icon_dir="$dest/Runner/Assets.xcassets/AppIcon.appiconset"
rm -rf "$icon_dir"; mkdir -p "$icon_dir"
cp "$root/tool/ios-icons/$app-1024.png" "$icon_dir/AppIcon-1024.png"
printf '%s\n' '{"images":[{"filename":"AppIcon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}' > "$icon_dir/Contents.json"

# iOS 15 is the floor (instance-level CLLocationManager authorization, MapLibre, background location); the generated Podfile leaves the platform to the project's own target.
sed -i '' -E 's/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = 15.0;/' "$dest/Runner.xcodeproj/project.pbxproj"
# iPhone only: the Flutter default declares iPad too (TARGETED_DEVICE_FAMILY "1,2"), which makes App Store review require iPad screenshots.
sed -i '' -E 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = "1";/' "$dest/Runner.xcodeproj/project.pbxproj"

# The bundle id must be the App ID the owner registered with Apple, for the app and its test target alike.
grep -q "PRODUCT_BUNDLE_IDENTIFIER = $app_id;" "$dest/Runner.xcodeproj/project.pbxproj" || { echo "bundle id $app_id not found in the generated project" >&2; exit 1; }

# The Cao Bang offline map package: ONE committed copy (gps-test assets), copied into the map plugin so CocoaPods bundles it. Checked against its manifest first.
map_src="$root/gps-test/app/src/main/assets/caobang"
map_dst="$root/packages/n11_m14_map/ios/caobang"
python3 - "$map_src" <<'PYCODE'
import hashlib, json, os, sys
root = sys.argv[1]
manifest = json.load(open(os.path.join(root, 'manifest.json')))
for name, digest in manifest['sha256'].items():
    assert hashlib.sha256(open(os.path.join(root, name), 'rb').read()).hexdigest() == digest, name + ' differs from the manifest'
for name in ('map.geojson', 'style.json'):
    assert name in manifest['sha256'], name + ' missing checksum'
PYCODE
rm -rf "$map_dst"
cp -R "$map_src" "$map_dst"

plist="$dest/Runner/Info.plist"
set_key() { # key type value
  /usr/libexec/PlistBuddy -c "Delete :$1" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$plist"
}
set_key CFBundleDisplayName string "$label"
set_key CFBundleName string "$label"
set_key NSLocationWhenInUseUsageDescription string "$location_text"
set_key NSCameraUsageDescription string "$camera_text"
set_key NSPhotoLibraryUsageDescription string "$photos_text"
# No custom cryptography beyond the system TLS and Keychain: lets TestFlight skip the export-compliance question.
set_key ITSAppUsesNonExemptEncryption bool false
# 11Ship shares the shipper's position while the app runs in the background (started from the open app, "While Using" permission only).
if [ "$app" = ship ]; then
  /usr/libexec/PlistBuddy -c "Delete :UIBackgroundModes" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$plist"
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string location" "$plist"
fi
# M08 push (optional), like Android: FCM_PROJECT_ID, FCM_SENDER_ID, FCM_APP_ID and FCM_API_KEY of THIS app's Firebase iOS client. All four valid = the build carries
# push (identifiers go to Info.plist, the aps-environment entitlement is added); none = a build without push (the app says so); some or an invalid one stops the build.
push="off"
set_count=0
for v in FCM_PROJECT_ID FCM_SENDER_ID FCM_APP_ID FCM_API_KEY; do
  if [ -n "${!v:-}" ]; then set_count=$((set_count + 1)); fi
done
if [ "$set_count" -gt 0 ]; then
  bad=""
  printf '%s' "${FCM_PROJECT_ID:-}" | grep -Eq '^[a-z][a-z0-9-]{3,62}$' || bad="$bad FCM_PROJECT_ID"
  printf '%s' "${FCM_SENDER_ID:-}" | grep -Eq '^[0-9]{6,20}$' || bad="$bad FCM_SENDER_ID"
  printf '%s' "${FCM_APP_ID:-}" | grep -Eq '^[0-9]+:[0-9]+:ios:[0-9a-f]{8,64}$' || bad="$bad FCM_APP_ID"
  printf '%s' "${FCM_API_KEY:-}" | grep -Eq '^[A-Za-z0-9_-]{20,64}$' || bad="$bad FCM_API_KEY"
  if [ -n "$bad" ]; then
    echo "push configuration incomplete or invalid (set all four or none):$bad" >&2
    exit 1
  fi
  push="on"
  set_key N11_FCM_PROJECT_ID string "$FCM_PROJECT_ID"
  set_key N11_FCM_SENDER_ID string "$FCM_SENDER_ID"
  set_key N11_FCM_APP_ID string "$FCM_APP_ID"
  set_key N11_FCM_API_KEY string "$FCM_API_KEY"
  # Xcode's signing replaces this with the value of the provisioning profile (development for debug, production for TestFlight and the store).
  aps="${IOS_APS_ENVIRONMENT:-development}"
  case "$aps" in development|production) ;; *) echo "IOS_APS_ENVIRONMENT must be development or production" >&2; exit 1 ;; esac
  ent="$dest/Runner/Runner.entitlements"
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict>' "<key>aps-environment</key><string>$aps</string>" '</dict></plist>' > "$ent"
  perl -0pi -e "s/(PRODUCT_BUNDLE_IDENTIFIER = \Q$app_id\E;)/\$1\n\t\t\t\t CODE_SIGN_ENTITLEMENTS = Runner\/Runner.entitlements;/g" "$dest/Runner.xcodeproj/project.pbxproj"
  grep -q "CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;" "$dest/Runner.xcodeproj/project.pbxproj" || { echo "entitlements were not linked to the project" >&2; exit 1; }
fi
# canOpenURL("tel:") for the dialer; the app opens no other scheme.
/usr/libexec/PlistBuddy -c "Delete :LSApplicationQueriesSchemes" "$plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSApplicationQueriesSchemes array" "$plist"
/usr/libexec/PlistBuddy -c "Add :LSApplicationQueriesSchemes:0 string tel" "$plist"
/usr/libexec/PlistBuddy -c "Print" "$plist" > /dev/null
echo "prepared $dest ($app_id) push=$push"
