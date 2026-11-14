#!/usr/bin/env bash
# Signs an Android App Bundle for Google Play with the UPLOAD key only.
# Flutter's release bundle carries the debug key's signature; that signature is removed first (signature files only, the
# rest of META-INF stays), then the bundle is signed once with the upload key. The result is verified to carry exactly one
# signer whose certificate is the upload keystore's, and that certificate must differ from the APK's app-signing certificate.
# Usage: mobile/tool/sign-aab.sh <unsigned.aab> <signed-out.aab> <apk-signer-sha256>
# Env (secrets, never printed): ANDROID_UPLOAD_KEYSTORE_BASE64, ANDROID_UPLOAD_KEYSTORE_PASSWORD, ANDROID_UPLOAD_KEY_ALIAS,
#   ANDROID_UPLOAD_KEY_PASSWORD. Optional public pins: ANDROID_APP_SIGNER_PIN, ANDROID_UPLOAD_CERT_PIN (lowercase hex SHA-256).
set -euo pipefail

src="${1:-}"; out="${2:-}"; apk_fp="${3:-}"
[ -n "$src" ] && [ -n "$out" ] || { echo "usage: $0 <unsigned.aab> <signed-out.aab> <apk-signer-sha256>" >&2; exit 2; }
[ -f "$src" ] || { echo "::error title=aab missing::unsigned bundle not found" >&2; exit 1; }
for v in ANDROID_UPLOAD_KEYSTORE_BASE64 ANDROID_UPLOAD_KEYSTORE_PASSWORD ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD; do
  [ -n "${!v:-}" ] || { echo "::error title=upload key missing::$v is not set (names only)" >&2; exit 1; }
done
printf '%s' "$apk_fp" | grep -Eq '^[0-9a-f]{64}$' || { echo "::error title=apk fingerprint missing::the APK signer digest is not known" >&2; exit 1; }

work="$(mktemp -d)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

# 1. Remove the existing signature (META-INF signature files and manifest only). Everything else is copied byte-for-byte.
python3 - "$src" "$work/unsigned-clean.aab" <<'PY'
import re, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
signature = re.compile(r'^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$', re.IGNORECASE)
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        if signature.match(info.filename):
            continue
        zout.writestr(info, zin.read(info.filename), compress_type=info.compress_type)
PY

# 2. Sign once with the upload key.
printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 -d > "$work/upload.jks"
cp "$work/unsigned-clean.aab" "$out"
jarsigner -keystore "$work/upload.jks" -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD -keypass:env ANDROID_UPLOAD_KEY_PASSWORD \
  -sigalg SHA256withRSA -digestalg SHA-256 "$out" "$ANDROID_UPLOAD_KEY_ALIAS" >/dev/null

# 3. Verify: the signature is valid, there is exactly one signature block and exactly one signer, and that signer is the upload certificate.
verify="$(jarsigner -verify "$out" 2>&1)" || { echo "::error title=aab verify failed::jarsigner rejected the bundle" >&2; exit 1; }
printf '%s\n' "$verify" | grep -q 'jar verified' || { echo "::error title=aab verify failed::bundle not verified" >&2; exit 1; }
blocks="$(unzip -Z1 "$out" | grep -cE '^META-INF/[^/]+\.(RSA|DSA|EC)$' || true)"
[ "$blocks" = 1 ] || { echo "::error title=aab signer count::expected exactly one signature block, found $blocks" >&2; exit 1; }
signers="$(keytool -printcert -jarfile "$out" 2>/dev/null | grep -c '^Signer #' || true)"
[ "$signers" = 1 ] || { echo "::error title=aab signer count::expected one signer, found $signers" >&2; exit 1; }
aab_fp="$(keytool -printcert -jarfile "$out" 2>/dev/null | grep 'SHA256:' | head -n 1 | sed -E 's/.*SHA256: *//' | tr -d ':' | tr 'A-F' 'a-f')"
up_fp="$(keytool -exportcert -keystore "$work/upload.jks" -alias "$ANDROID_UPLOAD_KEY_ALIAS" -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD 2>/dev/null | sha256sum | cut -d' ' -f1)"
rm -f "$work/upload.jks"
[ "$aab_fp" = "$up_fp" ] || { echo "::error title=aab signer mismatch::the bundle is not signed with the upload keystore certificate" >&2; exit 1; }
# The upload key must differ from the APK's app-signing key (Play App Signing), and both pins are checked when the Owner has set them.
[ "$aab_fp" != "$apk_fp" ] || { echo "::error title=upload key equals app-signing key::use a separate upload key" >&2; exit 1; }
if [ -n "${ANDROID_APP_SIGNER_PIN:-}" ] && [ "$aab_fp" = "$ANDROID_APP_SIGNER_PIN" ]; then
  echo "::error title=upload key equals app-signing key::use a separate upload key" >&2; exit 1
fi
if [ -n "${ANDROID_UPLOAD_CERT_PIN:-}" ] && [ "$aab_fp" != "$ANDROID_UPLOAD_CERT_PIN" ]; then
  echo "::error title=upload cert pin mismatch::the bundle is not signed with the pinned upload certificate" >&2; exit 1
fi
echo "aab signer sha256 $aab_fp (upload key, one signer)"
