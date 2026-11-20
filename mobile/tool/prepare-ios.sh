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
        location_text="11Ship dùng vị trí hiện tại của bạn để chọn điểm đón, điểm giao và tìm đơn gần bạn."
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
# canOpenURL("tel:") for the dialer; the app opens no other scheme.
/usr/libexec/PlistBuddy -c "Delete :LSApplicationQueriesSchemes" "$plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSApplicationQueriesSchemes array" "$plist"
/usr/libexec/PlistBuddy -c "Add :LSApplicationQueriesSchemes:0 string tel" "$plist"
/usr/libexec/PlistBuddy -c "Print" "$plist" > /dev/null
echo "prepared $dest ($app_id)"
