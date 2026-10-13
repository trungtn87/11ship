#!/usr/bin/env bash
# Exact permission allowlist of a built APK (reads `aapt2 dump badging`). Anything not listed fails, so a new plugin cannot quietly add
# background location, camera, contacts, storage or any other permission.
#   INTERNET                                   both apps
#   vn.eleven.n11.permission.PEER_ENDORSEMENT  both apps (signature permission of the Binder door between the two apps)
#   <applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION  added by AndroidX itself (not grantable to other apps)
#   ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION  11Food only (foreground, one fix at the shop); never ACCESS_BACKGROUND_LOCATION
# Usage: check-apk-permissions.sh <food|ship> <badging-file>
set -euo pipefail
app="${1:?app}"; badging="${2:?badging file}"
case "$app" in
  food) app_id="vn.eleven.food.test"; allowed="android.permission.INTERNET vn.eleven.n11.permission.PEER_ENDORSEMENT $app_id.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION" ;;
  ship) app_id="vn.eleven.ship.test"; allowed="android.permission.INTERNET vn.eleven.n11.permission.PEER_ENDORSEMENT $app_id.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" ;;
  *) echo "usage: $0 <food|ship> <badging-file>" >&2; exit 2 ;;
esac
found="$(sed -n "s/^uses-permission[a-z0-9-]*: name='\([^']*\)'.*/\1/p" "$badging" | sort -u)"
bad=""
for name in $found; do
  case " $allowed " in *" $name "*) ;; *) bad="$bad $name" ;; esac
done
for need in android.permission.INTERNET vn.eleven.n11.permission.PEER_ENDORSEMENT; do
  printf '%s\n' "$found" | grep -qx "$need" || bad="$bad missing:$need"
done
if [ -n "$bad" ]; then
  echo "::error title=unexpected permission::$app permissions outside the allowlist:$bad"
  exit 1
fi
echo "permissions ($app): $(printf '%s' "$found" | tr '\n' ' ')"
