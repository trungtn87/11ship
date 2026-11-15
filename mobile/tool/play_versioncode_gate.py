#!/usr/bin/env python3
# Play versionCode gate (STORE-01 PR-B, M13.07). Used by check-aab-release.py and by tests/deploy/play-versioncode-gate.test.mjs.
#
# The record mobile/release/play-submitted-versioncode.json holds, per package, the highest versionCode that Google Play has
# ACCEPTED (Owner confirmed). A bundle may be released only when its versionCode is strictly greater than that value for its own
# package. A build, a downloaded artifact or a file on a PC is NOT a submission. Only a separate PR, made after Owner confirms
# that Play received the AAB, may change the record. The record is public and holds no secret.
#
# CLI (for the guard tests and for manual checks; never needs a secret):
#   play_versioncode_gate.py check <food|ship> <versionCode> [--record PATH]
#   play_versioncode_gate.py validate [--record PATH]
#   play_versioncode_gate.py not-decreased <base-record.json> <current-record.json>
import datetime
import json
import os
import re
import sys

RECORD_PATH = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'release', 'play-submitted-versioncode.json'))
SCHEMA = '11ship.play-submitted-versioncode.v1'
PACKAGES = {'food': 'vn.eleven.food', 'ship': 'vn.eleven.ship'}
TOP_KEYS = {'schema', 'rule', 'apps'}
APP_KEYS = {'package', 'highest_submitted_version_code', 'highest_submitted_version_name', 'owner_confirmed_on'}
MAX_VERSION_CODE = 2100000000  # Android's versionCode ceiling
NAME_RE = re.compile(r'\d+\.\d+\.\d+')


class GateError(Exception):
    pass


def _reject_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise GateError(f'duplicate key {key!r} in the record')
        out[key] = value
    return out


def load_record(path=RECORD_PATH):
    try:
        with open(path, encoding='utf-8') as handle:
            return json.load(handle, object_pairs_hook=_reject_duplicate_keys)
    except FileNotFoundError:
        raise GateError(f'the Play submitted-versionCode record is missing: {path}')
    except (OSError, ValueError) as error:
        raise GateError(f'the Play submitted-versionCode record cannot be read as JSON: {error}')


def validate_record(record):
    """Return {app: highest submitted versionCode}. Raises GateError on any schema violation."""
    if not isinstance(record, dict) or set(record) != TOP_KEYS:
        raise GateError('record keys must be exactly: schema, rule, apps')
    if record['schema'] != SCHEMA:
        raise GateError(f'record schema must be {SCHEMA!r}')
    if not isinstance(record['rule'], str) or not record['rule'].strip():
        raise GateError('record rule must be a non-empty string')
    apps = record['apps']
    if not isinstance(apps, dict) or set(apps) != set(PACKAGES):
        raise GateError('record apps must contain exactly food and ship')
    submitted = {}
    for app, package in PACKAGES.items():
        entry = apps[app]
        if not isinstance(entry, dict) or set(entry) != APP_KEYS:
            raise GateError(f'{app}: keys must be exactly {", ".join(sorted(APP_KEYS))}')
        if entry['package'] != package:
            raise GateError(f'{app}: package must be {package!r}, the record says {entry["package"]!r}')
        code = entry['highest_submitted_version_code']
        # bool is a subclass of int in Python: reject it explicitly, along with floats and numeric strings.
        if type(code) is not int or not 0 <= code <= MAX_VERSION_CODE:
            raise GateError(f'{app}: highest_submitted_version_code must be an integer from 0 to {MAX_VERSION_CODE}')
        name = entry['highest_submitted_version_name']
        confirmed = entry['owner_confirmed_on']
        if code == 0:
            if name is not None or confirmed is not None:
                raise GateError(f'{app}: with no submitted build, the name and owner_confirmed_on must be null')
        else:
            if not isinstance(name, str) or not NAME_RE.fullmatch(name):
                raise GateError(f'{app}: highest_submitted_version_name must be MAJOR.MINOR.PATCH when a build was submitted')
            if not isinstance(confirmed, str):
                raise GateError(f'{app}: owner_confirmed_on (YYYY-MM-DD) is required when a build was submitted')
            try:
                datetime.date.fromisoformat(confirmed)
            except ValueError:
                raise GateError(f'{app}: owner_confirmed_on must be a YYYY-MM-DD date')
        submitted[app] = code
    return submitted


def check_gate(app, version_code, record):
    """The bundle versionCode must be strictly greater than the highest Play-submitted versionCode of the same package."""
    if app not in PACKAGES:
        raise GateError('app must be food or ship')
    if type(version_code) is not int or version_code < 1:
        raise GateError('the bundle versionCode must be a positive integer')
    submitted = validate_record(record)[app]
    if version_code <= submitted:
        raise GateError(f'{PACKAGES[app]} versionCode {version_code} must be greater than the highest Play-submitted versionCode {submitted} '
                        f'(record mobile/release/play-submitted-versioncode.json)')
    return submitted


def check_not_decreased(base, current):
    """The record may stay or rise for each package, never fall (the CI guard compares it with origin/main)."""
    base_codes = validate_record(base)
    current_codes = validate_record(current)
    for app in PACKAGES:
        if current_codes[app] < base_codes[app]:
            raise GateError(f'{app}: highest_submitted_version_code fell from {base_codes[app]} to {current_codes[app]}; '
                            'a submitted versionCode can never be lowered')


def _record_option(args):
    if '--record' not in args:
        return RECORD_PATH, args
    i = args.index('--record')
    if i + 1 >= len(args):
        raise GateError('--record needs a path')
    return args[i + 1], args[:i] + args[i + 2:]


def main(argv):
    try:
        if len(argv) < 2:
            raise GateError('usage: check <app> <versionCode> | validate | not-decreased <base> <current>')
        command, rest = argv[1], argv[2:]
        if command == 'check':
            path, rest = _record_option(rest)
            if len(rest) != 2 or not rest[1].isdigit():
                raise GateError('usage: check <food|ship> <versionCode> [--record PATH]')
            submitted = check_gate(rest[0], int(rest[1]), load_record(path))
            print(f'play versionCode gate ok ({rest[0]}): {rest[1]} > submitted {submitted}')
        elif command == 'validate':
            path, rest = _record_option(rest)
            if rest:
                raise GateError('usage: validate [--record PATH]')
            submitted = validate_record(load_record(path))
            print(f'play submitted-versionCode record valid: food {submitted["food"]}, ship {submitted["ship"]}')
        elif command == 'not-decreased':
            if len(rest) != 2:
                raise GateError('usage: not-decreased <base-record.json> <current-record.json>')
            check_not_decreased(load_record(rest[0]), load_record(rest[1]))
            print('play submitted-versionCode record did not decrease')
        else:
            raise GateError(f'unknown command {command!r}')
    except GateError as error:
        print(f'::error title=play versionCode gate::{error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
