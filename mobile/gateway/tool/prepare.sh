#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flutter create --platforms android --project-name gateway --org vn.eleven --no-pub .
# Generated template widget test references nonexistent MyApp.
rm -f test/widget_test.dart
python3 - <<'PY'
from pathlib import Path
import re
import xml.etree.ElementTree as ET
manifest = Path("android/app/src/main/AndroidManifest.xml")
a = "{http://schemas.android.com/apk/res/android}"
ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
doc = ET.parse(manifest)
root = doc.getroot()
# SEND_SMS is the only SMS permission: no READ/RECEIVE SMS, contacts or phone state (the CI badging check enforces it).
# INTERNET is needed in the RELEASE build (the template only declares it for debug/profile). FOREGROUND_SERVICE* keep the poller
# alive with the screen off, POST_NOTIFICATIONS shows its (code-free) notification, RECEIVE_BOOT_COMPLETED restarts it after a
# reboot or an in-place update, WAKE_LOCK keeps the CPU running while it is on, and the battery permission lets the Owner
# exempt it from battery optimisation.
for name in [
    "android.permission.SEND_SMS",
    "android.permission.INTERNET",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
]:
    if not any(x.attrib.get(a + "name") == name for x in root.findall("uses-permission")):
        root.insert(0, ET.Element("uses-permission", {a + "name": name}))
app = root.find("application")
assert app is not None
app.set(a + "label", "11Ship SMS Gateway")
app.set(a + "usesCleartextTraffic", "false")
# The sealed credential is bound to a Keystore key that is not backed up: never restore the preferences onto another device.
app.set(a + "allowBackup", "false")
app.set(a + "fullBackupContent", "false")
service = ET.SubElement(app, "service", {
    a + "name": ".GatewayService",
    a + "exported": "false",
    a + "foregroundServiceType": "specialUse",
})
ET.SubElement(service, "property", {
    a + "name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
    a + "value": "sms_otp_gateway",
})
receiver = ET.SubElement(app, "receiver", {a + "name": ".GatewayBootReceiver", a + "exported": "false"})
intent_filter = ET.SubElement(receiver, "intent-filter")
ET.SubElement(intent_filter, "action", {a + "name": "android.intent.action.BOOT_COMPLETED"})
ET.SubElement(intent_filter, "action", {a + "name": "android.intent.action.MY_PACKAGE_REPLACED"})
doc.write(manifest, encoding="utf-8", xml_declaration=True)
gradle = Path("android/app/build.gradle.kts")
s = gradle.read_text()
assert 'applicationId = "vn.eleven.gateway"' in s
s = s.replace('applicationId = "vn.eleven.gateway"', 'applicationId = "vn.eleven.gateway.test"')
# Keystore AES-GCM (API 23) and Service.STOP_FOREGROUND_REMOVE (API 24).
s, n = re.subn(r"minSdk\s*=\s*[^\n]+", "minSdk = 24", s, count=1)
assert n == 1, "minSdk line not found"
# JVM unit tests of the pure-Kotlin parts (tool/test): the pending-report slot of the gateway.
if "testImplementation" not in s:
    s += '\ndependencies {\n    testImplementation("junit:junit:4.13.2")\n}\n'
gradle.write_text(s)
PY
mkdir -p android/app/src/main/kotlin/vn/eleven/gateway
for f in MainActivity GatewayStore GatewayApi GatewayService GatewayBootReceiver; do
  cp "tool/$f.kt" "android/app/src/main/kotlin/vn/eleven/gateway/$f.kt"
done
mkdir -p android/app/src/test/kotlin/vn/eleven/gateway
cp tool/ReportFlusher.kt android/app/src/main/kotlin/vn/eleven/gateway/ReportFlusher.kt
cp tool/test/ReportFlusherTest.kt android/app/src/test/kotlin/vn/eleven/gateway/ReportFlusherTest.kt
