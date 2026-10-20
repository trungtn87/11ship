#!/usr/bin/env python3
"""Capture the signed Ship APK on Android; read-only guest UI, never request SMS.

Run only against a disposable emulator. Authentication/OTP success is covered by
Flutter/controller tests; this smoke does not claim real-device attestation.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = 'vn.eleven.ship.test'
OUTPUT = Path(os.environ.get('SHIP_UI_OUTPUT', '/tmp/ship-android-ui'))
OUTPUT.mkdir(parents=True, exist_ok=True)


def adb(*args, binary=False):
    return subprocess.check_output(['adb', *args], timeout=25, text=not binary)


def nodes():
    # Right after a cold start uiautomator can answer "null root node" (no window yet): that is "not ready", not a result, so the caller's wait loop
    # asks again. A real failure (the app never shows its UI) still ends in the wait's AssertionError, with the logcat printed below.
    try:
        adb('shell', 'uiautomator', 'dump', '/sdcard/ship-ui.xml')
        raw = adb('exec-out', 'cat', '/sdcard/ship-ui.xml')
        (OUTPUT / 'latest-hierarchy.xml').write_text(raw)
        return list(ET.fromstring(raw).iter('node'))
    except (subprocess.SubprocessError, ET.ParseError):
        return []


def find(label):
    matches = []
    for node in nodes():
        text = node.get('text', '') + '\n' + node.get('content-desc', '')
        bounds = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
        if label in text and len(bounds) == 4:
            x1, y1, x2, y2 = bounds
            if x2 > x1 and y2 > y1:
                matches.append(((x2-x1)*(y2-y1), ((x1+x2)//2, (y1+y2)//2)))
    return min(matches)[1] if matches else None


def wait(label):
    for _ in range(12):
        position = find(label)
        if position is not None:
            return position
        time.sleep(1)
    raise AssertionError(f'Android UI did not expose: {label}')


def tap(label):
    x, y = wait(label)
    adb('shell', 'input', 'tap', str(x), str(y))
    time.sleep(1)


def capture(name):
    time.sleep(1)
    (OUTPUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))


try:
    adb('install', '-r', '11Ship-test.apk')
    # Cold launch without network or location access: map must render from APK assets.
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    adb('shell', 'settings', 'put', 'secure', 'location_mode', '0')
    # Set density first so Launcher never sees 360px at the Pixel's old high DPI.
    adb('shell', 'wm', 'density', '160')
    adb('shell', 'wm', 'size', '360x640')
    time.sleep(1)
    adb('logcat', '-c')
    adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1')
    wait('Chưa xác định trạng thái hoạt động')
    wait('Chưa bật chia sẻ vị trí')
    wait('Bản đồ offline Cao Bằng đã hiển thị')
    hierarchy = nodes()
    online = [n for n in hierarchy if 'Bật online' in (n.get('text', '') + n.get('content-desc', '')) and n.get('clickable') == 'true']
    assert not online, 'unknown activity must not expose an online action'
    assert not any('trong M01' in (n.get('text', '') + n.get('content-desc', '')) for n in hierarchy)
    capture('01-home-offline-no-gps')
    adb('shell', 'svc', 'wifi', 'enable')
    for tab, title, name in [
        ('Thông báo', 'Đăng nhập để xem thông báo của bạn.', '02-notifications'),
        ('Đơn hàng', 'Chưa có đơn hàng', '03-orders'),
        ('Thu nhập', 'Chưa có dữ liệu thu nhập', '04-income'),
        ('Tài khoản', 'Tạo tài khoản', '05-account'),
    ]:
        tap(tab)
        wait(title)
        capture(name)
    tap('Tạo tài khoản')
    wait('Đăng ký shipper')
    capture('06-register-step1')
    adb('shell', 'input', 'keyevent', '4')
    tap('Đăng nhập')
    wait('Quên mật khẩu?')
    capture('07-login')
    tap('Quên mật khẩu?')
    wait('Quên mật khẩu')
    capture('08-forgot-password')
    logs = adb('logcat', '-d', '-s', 'flutter:E', 'AndroidRuntime:E')
    (OUTPUT / 'runtime.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'A RenderFlex overflowed' not in logs, logs
    (OUTPUT / 'result.json').write_text(json.dumps({
        'package': PACKAGE,
        'sha': os.environ.get('SOURCE_SHA'),
        'platform': 'Android emulator API 30',
        'result': 'guest UI and offline Cao Bang map without network/GPS passed',
        'not_tested': ['real device', 'online operation', 'SMS/OTP success', 'account creation'],
    }, ensure_ascii=False, indent=2))
finally:
    capture('last-screen')
    log = adb('logcat', '-d', '-t', '1500')
    (OUTPUT / 'logcat.txt').write_text(log)
    # The lines that explain a launch that never showed its UI, printed so the CI log carries them (the full logcat is in the artifact).
    key = re.compile(r'FATAL|AndroidRuntime|ClassNotFound|NoClassDefFound|UnsatisfiedLink|Error registering plugin|Process: vn\.eleven|ANR in|has died|Force finishing|vn\.eleven\.(ship|m14)', re.I)
    lines = [line for line in log.splitlines() if key.search(line)]
    print('--- logcat (filtered, last 80) ---')
    print('\n'.join(lines[-80:]))
