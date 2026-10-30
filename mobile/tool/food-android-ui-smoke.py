#!/usr/bin/env python3
"""Capture the signed 11Food APK home on Android without sending SMS.

The disposable emulator uses a Cao Bằng location and the real app/API. The
script never injects shops, dishes, prices or ratings.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = 'vn.eleven.food.test'
OUTPUT = Path(os.environ.get('FOOD_UI_OUTPUT', '/tmp/food-android-ui'))
OUTPUT.mkdir(parents=True, exist_ok=True)


def adb(*args, binary=False):
    return subprocess.check_output(['adb', *args], timeout=25, text=not binary)


def nodes():
    try:
        adb('shell', 'uiautomator', 'dump', '/sdcard/food-ui.xml')
        raw = adb('exec-out', 'cat', '/sdcard/food-ui.xml')
        (OUTPUT / 'latest-hierarchy.xml').write_text(raw)
        return list(ET.fromstring(raw).iter('node'))
    except (subprocess.SubprocessError, ET.ParseError):
        return []


def wait(label, attempts=30):
    for _ in range(attempts):
        for node in nodes():
            text = node.get('text', '') + '\n' + node.get('content-desc', '')
            bounds = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
            if label in text and len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                return
        time.sleep(1)
    raise AssertionError(f'Android UI did not expose: {label}')


def capture(name):
    time.sleep(1)
    (OUTPUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))


try:
    adb('install', '-r', '11Food-test.apk')
    adb('shell', 'wm', 'density', '160')
    adb('shell', 'wm', 'size', '390x844')
    adb('shell', 'svc', 'wifi', 'enable')
    adb('shell', 'svc', 'data', 'enable')
    adb('shell', 'settings', 'put', 'secure', 'location_mode', '3')
    # Grant only permissions already declared by the APK; failures remain visible
    # in logcat but do not turn this read-only screenshot into a permission test.
    for permission in ('android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'):
        subprocess.run(['adb', 'shell', 'pm', 'grant', PACKAGE, permission], check=False, capture_output=True, text=True)
    subprocess.run(['adb', 'emu', 'geo', 'fix', '106.257', '22.665'], check=False, capture_output=True, text=True)
    adb('logcat', '-c')
    adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1')
    wait('11Food')
    wait('Tìm quán hoặc món')
    wait('Quán gần bạn')
    capture('01-food-home-v5-390x844')
    logs = adb('logcat', '-d', '-s', 'flutter:E', 'AndroidRuntime:E')
    (OUTPUT / 'runtime.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'A RenderFlex overflowed' not in logs, logs
    (OUTPUT / 'result.json').write_text(json.dumps({
        'package': PACKAGE,
        'sha': os.environ.get('SOURCE_SHA'),
        'platform': 'Android emulator API 30',
        'viewport': '390x844 at 160 dpi',
        'result': 'real 11Food discovery home rendered with the live API and Cao Bang emulator location',
        'not_tested': ['real device', 'SMS/OTP success', 'placing an order'],
    }, ensure_ascii=False, indent=2))
finally:
    capture('last-screen')
    log = adb('logcat', '-d', '-t', '1500')
    (OUTPUT / 'logcat.txt').write_text(log)
    key = re.compile(r'FATAL|AndroidRuntime|ClassNotFound|NoClassDefFound|UnsatisfiedLink|Error registering plugin|Process: vn\.eleven|ANR in|has died|Force finishing|vn\.eleven\.food', re.I)
    lines = [line for line in log.splitlines() if key.search(line)]
    print('--- logcat (filtered, last 80) ---')
    print('\n'.join(lines[-80:]))
