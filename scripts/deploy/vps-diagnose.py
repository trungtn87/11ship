#!/usr/bin/env python3
"""Read-only, sanitized VPS diagnosis. Run as root; never prints environment values or raw journal."""
import json
import os
from pathlib import Path
import subprocess
import sys

SERVICE = sys.argv[1] if len(sys.argv) > 1 else '11ship-staging'
if SERVICE != '11ship-staging':
    raise SystemExit('inspect a different installation manually before adapting this script')


def command(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=45)
    return result.stdout.decode(errors='replace').strip()


try:
    print('UTC:', command('date', '-u', '--iso-8601=seconds'))
    print('Clock:', command('timedatectl', 'show', '-p', 'NTPSynchronized', '-p', 'TimeUSec'))
    for unit in [SERVICE, '11ship-attestation-refresh.service', '11ship-attestation-refresh.timer']:
        print(unit, command('systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result',
                            '-p', 'ExecMainStartTimestamp', '-p', 'ExecMainExitTimestamp', '-p', 'NextElapseUSecRealtime',
                            '-p', 'LastTriggerUSec'))
    pid = command('systemctl', 'show', SERVICE, '--property=MainPID', '--value')
    if not pid.isdigit() or pid == '0':
        raise RuntimeError('application is not running')
    root = Path('/proc/' + pid + '/cwd').resolve(strict=True)
    print('Running directory:', root)
    print('Release:', json.loads((root / 'RELEASE.json').read_text()).get('sourceSha', 'missing'))
    env = dict(item.split('=', 1) for item in Path('/proc/' + pid + '/environ').read_text().split('\0') if '=' in item)
    print('Production:', env.get('APP_ENV') == 'production', 'Android enabled:', env.get('CLIENT_AUTH_ANDROID_ENABLED') == 'true')
    for key in ['CLIENT_DEVICE_ALLOWED_SIGNERS_FILE', 'CLIENT_DEVICE_ATTESTATION_ROOTS_FILE', 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE']:
        try:
            path = Path(env[key])
            stat = path.stat()
            print(key, 'path=', str(path.resolve()), 'mode=', oct(stat.st_mode & 0o777), 'uid=', stat.st_uid,
                  'gid=', stat.st_gid, 'mtime=', stat.st_mtime)
        except (OSError, KeyError):
            print(key, 'MISSING/UNREADABLE')
    try:
        snapshot = json.loads(Path(env['CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE']).read_text())
        from datetime import datetime, timezone
        fetched = datetime.fromisoformat(snapshot['fetched_at'].replace('Z', '+00:00'))
        print('Snapshot age hours:', round((datetime.now(timezone.utc) - fetched).total_seconds() / 3600, 2),
              'entries:', len(snapshot['entries']))
    except Exception:
        print('Snapshot metadata: INVALID/UNREADABLE')
    # Report only known script-path classifications, never arbitrary ExecStart arguments.
    refresh_start = command('systemctl', 'show', '11ship-attestation-refresh.service', '--property=ExecStart', '--value')
    print('Refresh uses current:', '/opt/11ship/current/scripts/android-attestation-refresh.mjs' in refresh_start,
          'pins release:', '/releases/' in refresh_start)
    # Run with the actual process environment and credentials, not the root user's readable files.
    status = dict(line.split(':', 1) for line in Path('/proc/' + pid + '/status').read_text().splitlines() if ':' in line)
    uid = int(status['Uid'].split()[1])
    gid = int(status['Gid'].split()[1])
    groups = [int(g) for g in status['Groups'].split()]
    probe = root / 'scripts/deploy/android-readiness.cjs'
    # Old releases do not yet contain the CLI: use this reviewed checkout's CLI with the running release module root.
    if not probe.exists():
        probe = Path(__file__).with_name('android-readiness.cjs').resolve()
    env['SHIP11_DIAGNOSTIC_ROOT'] = str(root)
    result = subprocess.run(['/usr/bin/node', str(probe)], env=env, cwd=root, user=uid, group=gid,
                            extra_groups=groups, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    print('Actual-user readiness:', result.stdout.decode().strip() if result.returncode == 0 else 'FAILED; run the internal CLI locally for fixed diagnostics')
    # No raw logs: even the request's fields may contain personal information.
    logs = command('journalctl', '-u', SERVICE, '--since', '7 days ago', '--no-pager')
    request = '76a79b05-3b33-4ae7-b5b0-cb5a9fa25795'
    matches = [line for line in logs.splitlines() if request in line]
    print('Reported request ID log matches:', len(matches))
    refresh = command('journalctl', '-u', '11ship-attestation-refresh.service', '--since', '2 days ago', '--no-pager')
    print('Refresh log counters:', json.dumps({name: refresh.lower().count(name) for name in ['failed', 'permission denied', 'no such file', 'wrote']}))
    print('No Android device flow was exercised; readiness alone does not prove login.')
except Exception:
    raise SystemExit('diagnosis incomplete; inspect permissions/process/release locally (no secrets printed)')
