#!/usr/bin/env bash
# The ONLY source of an app's Android release identity: `version: MAJOR.MINOR.PATCH+BUILD` in mobile/<app>/pubspec.yaml.
# Prints "<versionName> <versionCode> <apk basename>", e.g. "1.0.0 1 11Food-v1.0.0". Every consumer (Flutter build flags, CI verification,
# APK name, the in-app version label) reads from here, so they cannot drift apart.
# versionCode must be a positive integer, increased for every distributed build of the same applicationId and never reset (see mobile/README.md).
# Usage: mobile/tool/app-version.sh <food|ship>
set -euo pipefail
app="${1:-}"
case "$app" in
  food) label="11Food" ;;
  ship) label="11Ship" ;;
  *) echo "usage: $0 <food|ship>" >&2; exit 2 ;;
esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
line="$(sed -n 's/^version: *//p' "$here/../$app/pubspec.yaml" | head -n 1 | tr -d '\r ')"
if ! [[ "$line" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\+([1-9][0-9]{0,8})$ ]]; then
  echo "mobile/$app/pubspec.yaml: version must be MAJOR.MINOR.PATCH+BUILD (BUILD a positive integer)" >&2
  exit 1
fi
name="${BASH_REMATCH[1]}"
code="${BASH_REMATCH[2]}"
printf '%s %s %s-v%s\n' "$name" "$code" "$label" "$name"
