#!/usr/bin/env bash
# Builds the Android project of one app: `flutter create` (so it always matches the installed Flutter), then the committed
# overlay (icons, splash, colours), the committed manifest/styles templates and the committed Kotlin sources of the device bridge
# (android-templates/kotlin: Keystore key, encrypted session store, signature-protected Binder door between the two apps, and the
# MainActivity that registers the channel). The generated android/ folder is not committed, so everything native lives in this repo.
# Usage: DEVICE_ENVIRONMENT=<id> mobile/tool/prepare-android.sh <food|ship>
#   DEVICE_ENVIRONMENT  non-secret identifier ([A-Za-z0-9._-]{1,64}) signed into every device proof; the server pins the same value.
#   Push (M08), optional: FCM_PROJECT_ID, FCM_SENDER_ID, FCM_APP_ID and FCM_API_KEY of THIS app's Firebase Android client (the same values google-services.json
#   holds for it; they ship in every APK of the app and are not the server's credential, which is a service-account file on the server only). All four set
#   and valid = the APK carries FCM; none set = a build WITHOUT push (the app says so). Some but not all, or an invalid one, stops the build (names only).
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

push="off"
fcm_set=0
for v in FCM_PROJECT_ID FCM_SENDER_ID FCM_APP_ID FCM_API_KEY; do
  [ -n "${!v:-}" ] && fcm_set=$((fcm_set + 1))
done
if [ "$fcm_set" -gt 0 ]; then
  bad=""
  printf '%s' "${FCM_PROJECT_ID:-}" | grep -Eq '^[a-z][a-z0-9-]{3,62}$' || bad="$bad FCM_PROJECT_ID"
  printf '%s' "${FCM_SENDER_ID:-}" | grep -Eq '^[0-9]{6,20}$' || bad="$bad FCM_SENDER_ID"
  printf '%s' "${FCM_APP_ID:-}" | grep -Eq '^[0-9]+:[0-9]+:android:[0-9a-f]{8,64}$' || bad="$bad FCM_APP_ID"
  printf '%s' "${FCM_API_KEY:-}" | grep -Eq '^[A-Za-z0-9_-]{20,64}$' || bad="$bad FCM_API_KEY"
  if [ -n "$bad" ]; then
    echo "push configuration incomplete or invalid (set all four or none):$bad" >&2
    exit 2
  fi
  push="on"
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

# Shared M14 native library uses Android 8+. Food remains on its existing minimum.
if [ "$app" = ship ]; then
  sed -i -E 's/minSdk = flutter.minSdkVersion/minSdk = 26/; s/minSdkVersion flutter.minSdkVersion/minSdkVersion 26/' "$gradle"
fi
res="$dest/app/src/main/res"
rm -rf "$res/drawable-v21" "$res/values-night" "$res/mipmap-hdpi/ic_launcher.webp" 2>/dev/null || true
find "$res" -name 'ic_launcher*' -delete
cp -R "$root/$app/android_overlay/res/." "$res/"

mkdir -p "$res/values" "$res/values-v31" "$res/drawable"
# Food declares one-shot shop location here. Ship gets explicit M14 foreground GPS permissions from the plugin manifest.
if [ "$app" = food ]; then
  location_permissions='<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/><uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>'
else
  location_permissions=''
fi
if [ "$push" = on ]; then
  push_permissions='<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'
  push_service='<service android:name="vn.eleven.n11.N11FirebaseService" android:exported="false"><intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter></service><meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="n11_sv"/><meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_n11"/><meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/n11_notification_color"/>'
else
  push_permissions=''
  push_service=''
fi
sed -e "s/@LABEL@/$label/g" -e "s/@PEER_PACKAGE@/$peer_id/g" -e "s/@DEVICE_ENVIRONMENT@/$environment/g" -e "s#@LOCATION_PERMISSIONS@#$location_permissions#" \
  -e "s#@PUSH_PERMISSIONS@#$push_permissions#" -e "s#@PUSH_SERVICE@#$push_service#" \
  "$here/android-templates/AndroidManifest.xml" > "$dest/app/src/main/AndroidManifest.xml"
cp "$here/android-templates/styles.xml" "$res/values/styles.xml"
cp "$here/android-templates/styles-v31.xml" "$res/values-v31/styles.xml"
cp "$here/android-templates/launch_background.xml" "$res/drawable/launch_background.xml"
if [ "$push" = on ]; then
  cp "$here/android-templates/ic_stat_n11.xml" "$res/drawable/ic_stat_n11.xml"
  printf '%s\n' '<?xml version="1.0" encoding="utf-8"?>' '<resources><color name="n11_notification_color">#D8AD18</color></resources>' > "$res/values/n11_push_colors.xml"
fi
mkdir -p "$res/xml"
cp "$here/android-templates/network_security_config.xml" "$res/xml/network_security_config.xml"
cp "$here/android-templates/n11_data_extraction_rules.xml" "$res/xml/n11_data_extraction_rules.xml"

# The native device bridge: shared Kotlin sources (package vn.eleven.n11) + this app's MainActivity.
kt="$dest/app/src/main/kotlin"
mkdir -p "$kt/vn/eleven/n11"
for f in N11DeviceStore N11DeviceKeys N11PeerPolicy N11PeerService N11PeerClient N11DeviceChannel; do
  cp "$here/android-templates/kotlin/$f.kt" "$kt/vn/eleven/n11/$f.kt"
done
cp "$here/android-templates/kotlin/N11Application.kt" "$kt/vn/eleven/n11/N11Application.kt"
if [ "$push" = on ]; then
  cp "$here/android-templates/kotlin/N11PushChannel.kt" "$kt/vn/eleven/n11/N11PushChannel.kt"
  cp "$here/android-templates/kotlin/N11FirebaseService.kt" "$kt/vn/eleven/n11/N11FirebaseService.kt"
  # The build's Firebase client identifiers, validated above (no quote, backslash or dollar can reach the Kotlin string).
  cat > "$kt/vn/eleven/n11/N11PushConfig.kt" <<KOTLIN
package vn.eleven.n11

object N11PushConfig {
    const val PROJECT_ID = "$FCM_PROJECT_ID"
    const val SENDER_ID = "$FCM_SENDER_ID"
    const val APP_ID = "$FCM_APP_ID"
    const val API_KEY = "$FCM_API_KEY"
}
KOTLIN
else
  cp "$here/android-templates/kotlin/N11PushChannelStub.kt" "$kt/vn/eleven/n11/N11PushChannel.kt"
fi
mkdir -p "$kt/vn/eleven/$app"
find "$kt" -name MainActivity.kt -delete
main_template="MainActivity.kt"
if [ "$app" = food ]; then
  main_template="MainActivityFood.kt"
  cp "$here/android-templates/kotlin/N11LocationChannel.kt" "$kt/vn/eleven/n11/N11LocationChannel.kt"
fi
sed "s/@APP_PACKAGE@/vn.eleven.$app/" "$here/android-templates/kotlin/$main_template" > "$kt/vn/eleven/$app/MainActivity.kt"
# JVM unit test of the Binder join rules (no device needed), run by `./gradlew :app:testDebugUnitTest` in CI.
mkdir -p "$dest/app/src/test/kotlin/vn/eleven/n11"
cp "$here/android-templates/kotlin-test/N11PeerPolicyTest.kt" "$dest/app/src/test/kotlin/vn/eleven/n11/N11PeerPolicyTest.kt"
case "$gradle" in
  *.kts) printf '\ndependencies {\n    testImplementation("junit:junit:4.13.2")\n}\n' >> "$gradle" ;;
  *) printf "\ndependencies {\n    testImplementation 'junit:junit:4.13.2'\n}\n" >> "$gradle" ;;
esac
if [ "$push" = on ]; then
  # FCM client library only; no Google Services Gradle plugin (the client identifiers are given above), so nothing else changes in the Gradle build.
  case "$gradle" in
    *.kts) printf '\ndependencies {\n    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))\n    implementation("com.google.firebase:firebase-messaging")\n}\n' >> "$gradle" ;;
    *) printf "\ndependencies {\n    implementation platform('com.google.firebase:firebase-bom:33.5.1')\n    implementation 'com.google.firebase:firebase-messaging'\n}\n" >> "$gradle" ;;
  esac
fi
rm -rf "$dest/app/src/debug" "$dest/app/src/profile" 2>/dev/null || true
# keep debug/profile manifests out: the permissions are declared in the main manifest only

echo "prepared $dest ($app_id) push=$push"
