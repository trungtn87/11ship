#!/usr/bin/env bash
# One-time helper for the Owner: creates the stable TEST signing key and stores it in GitHub Secrets.
# The key file stays on your computer (never commit it). Keep a backup: losing it means testers must uninstall the app once.
# Usage: mobile/tool/create-test-keystore.sh [owner/repo]   (needs keytool and an authenticated `gh`)
set -euo pipefail
repo="${1:-trungtn87/11ship}"
alias_name="n11-test"
dir="$(mktemp -d)"
store="$dir/n11-test.jks"
password="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | head -c 24)"

keytool -genkeypair -v -keystore "$store" -storetype PKCS12 -alias "$alias_name" -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=11Ship test, O=11Ship" -storepass "$password" -keypass "$password" >/dev/null

base64 -w0 "$store" | gh secret set ANDROID_TEST_KEYSTORE_BASE64 --repo "$repo"
printf '%s' "$password" | gh secret set ANDROID_TEST_KEYSTORE_PASSWORD --repo "$repo"
printf '%s' "$alias_name" | gh secret set ANDROID_TEST_KEY_ALIAS --repo "$repo"
printf '%s' "$password" | gh secret set ANDROID_TEST_KEY_PASSWORD --repo "$repo"

echo "Secrets set on $repo. Back up this file somewhere private, then delete the temporary copy:"
echo "  $store"
echo "  password: $password"
