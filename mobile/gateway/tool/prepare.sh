#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flutter create --platforms android --project-name gateway --org vn.eleven --no-pub .
python3 - <<'PY'
from pathlib import Path
import xml.etree.ElementTree as ET
manifest = Path("android/app/src/main/AndroidManifest.xml")
a = "{http://schemas.android.com/apk/res/android}"
ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
doc = ET.parse(manifest)
root = doc.getroot()
if not any(x.attrib.get(a + "name") == "android.permission.SEND_SMS"
           for x in root.findall("uses-permission")):
    root.insert(0, ET.Element("uses-permission", {a + "name": "android.permission.SEND_SMS"}))
app = root.find("application")
assert app is not None
app.set(a + "label", "11Ship SMS Gateway")
app.set(a + "usesCleartextTraffic", "false")
doc.write(manifest, encoding="utf-8", xml_declaration=True)
gradle = Path("android/app/build.gradle.kts")
s = gradle.read_text()
assert 'applicationId = "vn.eleven.gateway"' in s
gradle.write_text(s.replace('applicationId = "vn.eleven.gateway"', 'applicationId = "vn.eleven.gateway.test"'))
PY
mkdir -p android/app/src/main/kotlin/vn/eleven/gateway
cp tool/MainActivity.kt android/app/src/main/kotlin/vn/eleven/gateway/MainActivity.kt
