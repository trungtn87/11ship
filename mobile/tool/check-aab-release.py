#!/usr/bin/env python3
# Checks the MERGED manifest of a Play bundle (AAB) before it is published as a release artifact. The manifest comes from
# `bundletool dump manifest --bundle=<aab>` (XML), so the rules see what Play will see, after every plugin's manifest is merged.
# Exits 1 with a GitHub annotation on the first group of violations. Public values only; no secret is read or printed.
#
# Checked: package id, versionName/versionCode (equal to mobile/<app>/pubspec.yaml via app-version.sh), targetSdkVersion >= 36,
# the permission allowlist (the same list as mobile/tool/check-apk-permissions.sh, so an AAB and an APK cannot disagree), no
# REQUEST_INSTALL_PACKAGES anywhere, no background location anywhere, and the location service only where the app allows it:
# Food: no GPS service of any kind; Ship: ShipLocationService with the location foreground type (name "location" or flag 0x8, see
# has_location_fgs) and FOREGROUND_SERVICE_LOCATION.
# Usage: check-aab-release.py <food|ship> <manifest.xml> <expected versionName> <expected versionCode>
import re
import sys
import xml.etree.ElementTree as ET

# Same directory as this script: the Play submitted-versionCode gate (STORE-01 PR-B, M13.07).
import play_versioncode_gate as play_gate

ANDROID = '{http://schemas.android.com/apk/res/android}'
MIN_TARGET_SDK = 36

APPS = {
    'food': {
        'package': 'vn.eleven.food',
        'allowed': {
            'android.permission.INTERNET', 'vn.eleven.n11.permission.PEER_ENDORSEMENT',
            'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION',
            'android.permission.POST_NOTIFICATIONS', 'android.permission.WAKE_LOCK',
            'android.permission.ACCESS_NETWORK_STATE', 'com.google.android.c2dm.permission.RECEIVE',
        },
        'forbidden_services': ('ShipLocationService', 'RecorderService'),
        'may_have_fgs_location': False,
    },
    'ship': {
        'package': 'vn.eleven.ship',
        'allowed': {
            'android.permission.INTERNET', 'vn.eleven.n11.permission.PEER_ENDORSEMENT',
            'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_FINE_LOCATION',
            'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.FOREGROUND_SERVICE',
            'android.permission.FOREGROUND_SERVICE_LOCATION', 'android.permission.POST_NOTIFICATIONS',
            'android.permission.WAKE_LOCK', 'com.google.android.c2dm.permission.RECEIVE',
        },
        'forbidden_services': (),
        'may_have_fgs_location': True,
    },
}
# Never allowed in any Play build, whatever the app (install packages: M13 only tells, never installs; background location is not requested).
NEVER = {'android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.ACCESS_BACKGROUND_LOCATION'}


def fail(title, message):
    print(f'::error title={title}::{message}')
    sys.exit(1)


# foregroundServiceType is a set of flags. bundletool may print it as the name ("location"), a '|' list ("location|dataSync"), or the
# numeric/hex flag value (location = 0x8, so "8", "0x8", "9" = dataSync|location). Location is present when the name is listed or bit 0x8
# is set. "dataSync" (1), "0" and a missing attribute are NOT location.
LOCATION_FGS_BIT = 0x8


def has_location_fgs(value):
    if not value:
        return False
    for token in value.split('|'):
        token = token.strip()
        if token == 'location':
            return True
        if token.startswith(('0x', '0X')) and re.fullmatch(r'[0-9a-fA-F]+', token[2:] or ''):
            if int(token[2:], 16) & LOCATION_FGS_BIT:
                return True
        elif re.fullmatch(r'[0-9]+', token) and int(token, 10) & LOCATION_FGS_BIT:
            return True
    return False


def main(argv):
    if len(argv) != 5:
        print('usage: check-aab-release.py <food|ship> <manifest.xml> <versionName> <versionCode>', file=sys.stderr)
        return 2
    app_name, manifest_path, want_name, want_code = argv[1:]
    if app_name not in APPS:
        print('app must be food or ship', file=sys.stderr)
        return 2
    spec = APPS[app_name]
    root = ET.parse(manifest_path).getroot()
    if root.tag != 'manifest':
        fail('aab manifest', 'the dump is not a manifest')

    package = root.get('package')
    if package != spec['package']:
        fail('applicationId', f"expected {spec['package']}, the bundle says {package!r}")
    if root.get(ANDROID + 'versionName') != want_name or root.get(ANDROID + 'versionCode') != want_code:
        fail('version mismatch', f"bundle {root.get(ANDROID + 'versionName')}/{root.get(ANDROID + 'versionCode')} "
                                 f'but pubspec says {want_name}/{want_code}')

    # The versionCode must be above the highest versionCode Google Play has accepted for THIS package (per-package record).
    if not want_code.isdigit():
        fail('version mismatch', f'pubspec versionCode must be a positive integer, got {want_code!r}')
    try:
        submitted = play_gate.check_gate(app_name, int(want_code), play_gate.load_record())
    except play_gate.GateError as error:
        fail('play versionCode gate', str(error))

    target = root.find('uses-sdk')
    target_sdk = target.get(ANDROID + 'targetSdkVersion') if target is not None else None
    if target_sdk is None or not target_sdk.isdigit() or int(target_sdk) < MIN_TARGET_SDK:
        fail('targetSdk', f'targetSdkVersion must be >= {MIN_TARGET_SDK}, the bundle says {target_sdk!r}')

    permissions = set()
    for element in root:
        if element.tag in ('uses-permission', 'uses-permission-sdk-23'):
            name = element.get(ANDROID + 'name')
            if name:
                permissions.add(name)
    never = sorted(permissions & NEVER)
    if never:
        fail('forbidden permission', f'{app_name} must not request: ' + ', '.join(never))
    # AndroidX adds a receiver permission named after THIS app's own package only; another package's prefix is refused.
    own_receiver = spec['package'] + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
    allowed = spec['allowed'] | {own_receiver}
    unexpected = sorted(permissions - allowed)
    if unexpected:
        fail('unexpected permission', f'{app_name} permissions outside the allowlist: ' + ', '.join(unexpected))
    for need in ('android.permission.INTERNET', 'vn.eleven.n11.permission.PEER_ENDORSEMENT'):
        if need not in permissions:
            fail('missing permission', f'{app_name} must declare {need}')
    fgs = {'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION'}
    if spec['may_have_fgs_location']:
        # Ship's location service is a foreground service of type location: BOTH permissions are required, never one alone.
        missing = sorted(fgs - permissions)
        if missing:
            fail('missing permission', 'ship must declare ' + ' and '.join(missing) + ' (location foreground service)')
    else:
        present = sorted(fgs & permissions)
        if present:
            fail('forbidden permission', f'{app_name} must not declare ' + ', '.join(present))

    services = {}
    for service in root.iter('service'):
        services[service.get(ANDROID + 'name', '')] = service.get(ANDROID + 'foregroundServiceType')
    for name, fg_type in services.items():
        if any(marker in name for marker in spec['forbidden_services']):
            fail('forbidden service', f'{app_name} must not declare the GPS service {name}')
        if has_location_fgs(fg_type) and not spec['may_have_fgs_location']:
            fail('foreground service type', f'{app_name} must not declare a location foreground service ({name}, foregroundServiceType={fg_type!r})')
    if spec['may_have_fgs_location']:
        ship_service = [s for s in services if s.endswith('ShipLocationService')]
        if not ship_service:
            fail('service missing', 'ship must declare ShipLocationService')
        actual = services[ship_service[0]]
        if not has_location_fgs(actual):
            fail('foreground service type', f'ShipLocationService must declare foregroundServiceType with location (name "location" or flag 0x8); the bundle says foregroundServiceType={actual!r}')

    print(f'aab ok ({app_name}): {package} {want_name}+{want_code}, targetSdk {target_sdk}, '
          f'permissions {", ".join(sorted(permissions))}')
    print(f'play versionCode gate ok ({app_name}): {want_code} > highest submitted {submitted}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
