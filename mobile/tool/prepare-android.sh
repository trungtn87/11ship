#!/usr/bin/env bash
# Builds the Android project of one app: `flutter create` (so it always matches the installed Flutter), then the committed
# overlay (icons, splash, colours) and the committed manifest/styles templates. The generated android/ folder is not committed.
# Usage: mobile/tool/prepare-android.sh <food|ship>
set -euo pipefail

app="${1:-}"
case "$app" in
  food) label="11Food"; app_id="vn.eleven.food.test" ;;
  ship) label="11Ship"; app_id="vn.eleven.ship.test" ;;
  *) echo "usage: $0 <food|ship>" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
dest="$root/$app/android"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

rm -rf "$dest"
(cd "$tmp" && flutter create --project-name "$app" --org vn.eleven --platforms android --empty "$app" >/dev/null)
cp -R "$tmp/$app/android" "$dest"

# applicationId: distinct per app and stable forever (the Kotlin namespace stays vn.eleven.<app>).
gradle="$dest/app/build.gradle.kts"
[ -f "$gradle" ] || gradle="$dest/app/build.gradle"
grep -Eq 'applicationId\s*=?\s*"vn\.eleven\.'"$app"'"' "$gradle" || { echo "applicationId not found in $gradle" >&2; exit 1; }
sed -i -E 's/(applicationId\s*=?\s*)"vn\.eleven\.'"$app"'"/\1"'"$app_id"'"/' "$gradle"
grep -q "\"$app_id\"" "$gradle"

res="$dest/app/src/main/res"
rm -rf "$res/drawable-v21" "$res/values-night" "$res/mipmap-hdpi/ic_launcher.webp" 2>/dev/null || true
find "$res" -name 'ic_launcher*' -delete
cp -R "$root/$app/android_overlay/res/." "$res/"

mkdir -p "$res/values" "$res/values-v31" "$res/drawable"
sed "s/@LABEL@/$label/g" "$here/android-templates/AndroidManifest.xml" > "$dest/app/src/main/AndroidManifest.xml"
cp "$here/android-templates/styles.xml" "$res/values/styles.xml"
cp "$here/android-templates/styles-v31.xml" "$res/values-v31/styles.xml"
cp "$here/android-templates/launch_background.xml" "$res/drawable/launch_background.xml"
rm -rf "$dest/app/src/debug" "$dest/app/src/profile" 2>/dev/null || true
# keep debug/profile manifests out: INTERNET is declared in the main manifest and nothing else is wanted

echo "prepared $dest ($app_id)"
