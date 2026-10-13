#!/usr/bin/env bash
# Builds the Android project of one app: `flutter create` (so it always matches the installed Flutter), then the committed
# overlay (icons, splash, colours), the committed manifest/styles templates and the committed Kotlin sources of the device bridge
# (android-templates/kotlin: Keystore key, encrypted session store, signature-protected Binder door between the two apps, and the
# MainActivity that registers the channel). The generated android/ folder is not committed, so everything native lives in this repo.
# Usage: DEVICE_ENVIRONMENT=<id> mobile/tool/prepare-android.sh <food|ship>
#   DEVICE_ENVIRONMENT  non-secret identifier ([A-Za-z0-9._-]{1,64}) signed into every device proof; the server pins the same value.
set -euo pipefail

app="${1:-}"
case "$app" in
  food) label="11Food"; app_id="vn.eleven.food.test"; peer_id="vn.eleven.ship.test" ;;
  ship) label="11Ship"; app_id="vn.eleven.ship.test"; peer_id="vn.eleven.food.test" ;;
  *) echo "usage: $0 <food|ship>" >&2; exit 2 ;;
esac
environment="${DEVICE_ENVIRONMENT:-}"
if ! printf '%s' "$environment" | grep -Eq '^[A-Za-z0-9._-]{1,64}$'; then
  echo "DEVICE_ENVIRONMENT must be set to a non-secret identifier matching [A-Za-z0-9._-]{1,64}" >&2
  exit 2
fi

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
sed -e "s/@LABEL@/$label/g" -e "s/@PEER_PACKAGE@/$peer_id/g" -e "s/@DEVICE_ENVIRONMENT@/$environment/g" \
  "$here/android-templates/AndroidManifest.xml" > "$dest/app/src/main/AndroidManifest.xml"
cp "$here/android-templates/styles.xml" "$res/values/styles.xml"
cp "$here/android-templates/styles-v31.xml" "$res/values-v31/styles.xml"
cp "$here/android-templates/launch_background.xml" "$res/drawable/launch_background.xml"
mkdir -p "$res/xml"
cp "$here/android-templates/network_security_config.xml" "$res/xml/network_security_config.xml"
cp "$here/android-templates/n11_data_extraction_rules.xml" "$res/xml/n11_data_extraction_rules.xml"

# The native device bridge: shared Kotlin sources (package vn.eleven.n11) + this app's MainActivity.
kt="$dest/app/src/main/kotlin"
mkdir -p "$kt/vn/eleven/n11"
for f in N11DeviceStore N11DeviceKeys N11PeerPolicy N11PeerService N11PeerClient N11DeviceChannel; do
  cp "$here/android-templates/kotlin/$f.kt" "$kt/vn/eleven/n11/$f.kt"
done
mkdir -p "$kt/vn/eleven/$app"
find "$kt" -name MainActivity.kt -delete
sed "s/@APP_PACKAGE@/vn.eleven.$app/" "$here/android-templates/kotlin/MainActivity.kt" > "$kt/vn/eleven/$app/MainActivity.kt"
# JVM unit test of the Binder join rules (no device needed), run by `./gradlew :app:testDebugUnitTest` in CI.
mkdir -p "$dest/app/src/test/kotlin/vn/eleven/n11"
cp "$here/android-templates/kotlin-test/N11PeerPolicyTest.kt" "$dest/app/src/test/kotlin/vn/eleven/n11/N11PeerPolicyTest.kt"
case "$gradle" in
  *.kts) printf '\ndependencies {\n    testImplementation("junit:junit:4.13.2")\n}\n' >> "$gradle" ;;
  *) printf "\ndependencies {\n    testImplementation 'junit:junit:4.13.2'\n}\n" >> "$gradle" ;;
esac
rm -rf "$dest/app/src/debug" "$dest/app/src/profile" 2>/dev/null || true
# keep debug/profile manifests out: INTERNET is declared in the main manifest and nothing else is wanted

echo "prepared $dest ($app_id)"
