#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
bt="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}/build-tools/35.0.0"
test -x "$bt/apksigner" || bt="$(find "${ANDROID_SDK_ROOT:-$ANDROID_HOME}/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
work="$(mktemp -d)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
for name in ANDROID_TEST_KEYSTORE_BASE64 ANDROID_TEST_KEYSTORE_PASSWORD ANDROID_TEST_KEY_ALIAS ANDROID_TEST_KEY_PASSWORD; do
  test -n "${!name:-}" || { echo "Missing stable signing input: $name" >&2; exit 1; }
done
printf '%s' "$ANDROID_TEST_KEYSTORE_BASE64" | base64 -d > "$work/stable.jks"
mkdir -p artifact-out-m14
"$bt/zipalign" -f -p 4 mobile/gps-test/app/build/outputs/apk/release/app-release-unsigned.apk "$work/aligned.apk"
out=artifact-out-m14/11Ship-GPS-Test.apk
"$bt/apksigner" sign --ks "$work/stable.jks" --ks-key-alias "$ANDROID_TEST_KEY_ALIAS" --ks-pass env:ANDROID_TEST_KEYSTORE_PASSWORD --key-pass env:ANDROID_TEST_KEY_PASSWORD --out "$out" "$work/aligned.apk"
"$bt/apksigner" verify --verbose --print-certs "$out" > "$work/cert.txt"
"$bt/aapt2" dump badging "$out" > "$work/badging.txt"
grep -q "package: name='vn.eleven.ship.gpstest'" "$work/badging.txt"
grep -q "versionCode='$GPS_VERSION_CODE'" "$work/badging.txt"
python3 mobile/gps-test/tools/check-permissions.py "$work/badging.txt"
key_fp="$(keytool -exportcert -keystore "$work/stable.jks" -alias "$ANDROID_TEST_KEY_ALIAS" -storepass:env ANDROID_TEST_KEYSTORE_PASSWORD 2>/dev/null | sha256sum | cut -d' ' -f1)"
apk_fp="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$work/cert.txt")"
test "$key_fp" = "$apk_fp"
export M14_SIGNER_SHA256="$key_fp"
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
apk=Path('artifact-out-m14/11Ship-GPS-Test.apk')
manifest=json.loads(Path('mobile/gps-test/app/src/main/assets/caobang/manifest.json').read_text())
info=dict(application_id='vn.eleven.ship.gpstest',version_code=int(os.environ['GPS_VERSION_CODE']),signer_sha256=os.environ['M14_SIGNER_SHA256'],apk_sha256=hashlib.sha256(apk.read_bytes()).hexdigest(),source_sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),map_version=manifest['version'],routing_url=os.environ['GPS_ROUTING_URL'],physical_device_tested=False)
Path('artifact-out-m14/build-info.json').write_text(json.dumps(info,indent=2))
print(json.dumps(info,indent=2))
PY
