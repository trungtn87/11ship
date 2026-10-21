#!/usr/bin/env python3
"""Root-only VPS update. No env rewriting, seeds, resets, down migrations or DB restores."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time

BASE = Path('/opt/11ship')
ENV = '/etc/11ship/staging.env'
OPERATOR = '/root/ship11-secrets/operator.env'
SERVICE = '11ship-staging'
URL = 'https://103.9.78.67.sslip.io'
BACKUPS = Path('/var/backups/11ship')
POLICY = Path('/etc/11ship/migration-compatibility.json')
REFRESH_WRAPPER = Path('/opt/11ship/tools/refresh-android.sh')
REFRESH_WRAPPER_CONTENT = '\n'.join([
    '#!/bin/bash',
    'set -euo pipefail',
    'FILE=/etc/11ship/trust/android-attestation-revocation.json',
    'SCRIPT=$(readlink -f /opt/11ship/current/scripts/android-attestation-refresh.mjs)',
    '/usr/bin/node "$SCRIPT" "$FILE"',
    'chown root:ship11 "$FILE"',
    'chmod 640 "$FILE"',
]) + '\n'


def run(args, **kwargs):
    # Suppress child stderr: DB/network errors can contain secrets. No shell evaluation.
    try:
        return subprocess.run([str(a) for a in args], check=True, stderr=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, timeout=600, **kwargs).stdout.decode().strip()
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError('command failed: ' + str(args[0])) from None


def prop(name):
    return run(['systemctl', 'show', SERVICE, '--property=' + name, '--value'])


def verify_service():
    # Refuse a different installation rather than silently probing a guessed config/user.
    if prop('User') != 'ship11' or prop('Group') != 'ship11':
        raise RuntimeError('service user/group differs; inspect installation first')
    if prop('WorkingDirectory') != str(BASE / 'current'):
        raise RuntimeError('service WorkingDirectory differs')
    if prop('EnvironmentFiles') != ENV + ' (ignore_errors=no)':
        raise RuntimeError('service EnvironmentFiles differs')
    if 'apps/backend/dist/main.js' not in prop('ExecStart'):
        raise RuntimeError('service ExecStart differs')
    # An inline override could make the probe disagree with the server. Only the existing heap cap is allowed.
    if prop('Environment') not in ('', 'NODE_OPTIONS=--max-old-space-size=384'):
        raise RuntimeError('service has environment overrides; reconcile probe before update')
    if prop('RootDirectory') or prop('RootImage'):
        raise RuntimeError('unsupported service filesystem namespace')
    refresh_start = run(['systemctl', 'show', '11ship-attestation-refresh.service', '--property=ExecStart', '--value'])
    if 'argv[]=/opt/11ship/tools/refresh-android.sh ;' in refresh_start:
        st = REFRESH_WRAPPER.lstat()
        if (REFRESH_WRAPPER.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022
                or REFRESH_WRAPPER.read_text() != REFRESH_WRAPPER_CONTENT):
            raise RuntimeError('refresh wrapper content or permissions differ')
    elif '/opt/11ship/current/scripts/android-attestation-refresh.mjs /etc/11ship/trust/android-attestation-revocation.json' not in refresh_start or '/releases/' in refresh_start:
        raise RuntimeError('refresh service differs or pins an old release; complete initial setup')
    print('verified service: ' + SERVICE + ' (production must also pass application config check)')


def probe(release, mode='check', operator=False):
    cli = release / 'scripts/deploy/android-readiness.cjs'
    if not cli.exists():
        cli = Path(__file__).with_name('android-readiness.cjs').resolve()
    return run(['systemd-run', '--quiet', '--wait', '--pipe', '--collect',
                '-p', 'Type=oneshot', '-p', 'User=root' if operator else 'User=ship11',
                '-p', 'Group=root' if operator else 'Group=ship11',
                '-p', 'WorkingDirectory=' + str(release),
                *(['-p', 'EnvironmentFile=' + OPERATOR] if operator else []),
                '-p', 'EnvironmentFile=' + ENV,
                '-p', 'Environment=SHIP11_DIAGNOSTIC_ROOT=' + str(release),
                '-p', 'Environment=SHIP11_EXPECT_REVOCATION=/etc/11ship/trust/android-attestation-revocation.json',
                '/usr/bin/node', cli, mode])


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def extract(archive, sha):
    name = '11ship-' + sha + '-ubuntu24-amd64'
    archive = Path(archive).resolve()
    expected = archive.with_name(archive.name + '.sha256').read_text().strip()
    if archive.name != name + '.tar.gz' or expected != digest(archive) + '  ' + archive.name:
        raise RuntimeError('artifact name/checksum mismatch')
    releases = BASE / 'releases'
    releases.mkdir(exist_ok=True)
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        for member in members:
            parts = Path(member.name).parts
            if not parts or parts[0] != name or '..' in parts or not (member.isfile() or member.isdir()):
                raise RuntimeError('unsafe artifact entry (links/special files refused)')
        needed = sum(m.size for m in members) + archive.stat().st_size
        if shutil.disk_usage(releases).free < needed + 512 * 1024 * 1024:
            raise RuntimeError('insufficient disk space')
        target = releases / sha
        with tempfile.TemporaryDirectory(prefix='.unpack-', dir=releases) as work:
            tar.extractall(work, members=members, filter='data')
            tree = Path(work) / name
            if json.loads((tree / 'RELEASE.json').read_text())['sourceSha'] != sha:
                raise RuntimeError('RELEASE source SHA mismatch')
            listed = set()
            for line in (tree / 'MANIFEST.sha256').read_text().splitlines():
                match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
                if not match:
                    raise RuntimeError('invalid manifest')
                path = Path(match[2])
                if path.is_absolute() or '..' in path.parts or match[2] in listed:
                    raise RuntimeError('unsafe/duplicate manifest path')
                listed.add(match[2])
                if digest(tree / path) != match[1]:
                    raise RuntimeError('manifest checksum mismatch')
            actual = {str(p.relative_to(tree)) for p in tree.rglob('*') if p.is_file()}
            if actual != listed | {'MANIFEST.sha256'}:
                raise RuntimeError('unlisted artifact files')
            for path in actual:
                if not path.startswith('node_modules/') and re.search(r'(^|/)\.env($|\.)|\.(pem|key|p12|jks|keystore)$', path):
                    raise RuntimeError('secrets in artifact')
            # TemporaryDirectory is 0700; the release tree must be readable by ship11.
            if target.exists() or target.is_symlink():
                # A preflight refusal leaves the immutable release behind. Retry only
                # after comparing every file against the newly verified archive.
                verify_existing_release(target, tree)
            else:
                tree.rename(target)
    return target


def verify_existing_release(target, verified):
    if target.is_symlink() or not target.is_dir():
        raise RuntimeError('existing release is not a real directory')
    paths = list(target.rglob('*'))
    if any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in paths):
        raise RuntimeError('existing release contains links or special files')
    actual = {str(p.relative_to(target)) for p in paths if p.is_file()}
    expected = {str(p.relative_to(verified)) for p in verified.rglob('*') if p.is_file()}
    if actual != expected or any(digest(target / p) != digest(verified / p) for p in expected):
        raise RuntimeError('existing release differs; never overwrite a release')


def link(name, target):
    temp = BASE / (name + '.new')
    temp.unlink(missing_ok=True)
    temp.symlink_to(target)
    temp.replace(BASE / name)


def code_release(path):
    real = path.resolve(strict=True)
    if real.parent != (BASE / 'releases').resolve() or not real.is_dir() or not re.fullmatch(r'(?:[a-f0-9]{40}|11ship-[a-f0-9]{40}-ubuntu24-amd64)', real.name):
        raise RuntimeError('expected a direct SHA release directory')
    return real


def compatible(release, pending):
    if not pending:
        return
    if not POLICY.exists():
        raise RuntimeError('pending migrations require reviewed backward-compatible hashes; no schema change applied')
    policy = json.loads(POLICY.read_text())
    for name in pending:
        # Owner-reviewed exact migration content, not a blanket --allow flag.
        if policy.get(name) != digest(release / 'database/migrations' / (name + '.sql')):
            raise RuntimeError('pending migration lacks reviewed backward-compatible hash: ' + name)


def backup():
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(BACKUPS, 0o700)
    if shutil.disk_usage(BACKUPS).free < 512 * 1024 * 1024:
        raise RuntimeError('insufficient backup space')
    output = BACKUPS / ('ship11_staging-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.dump')
    with output.open('xb') as file:
        os.chmod(output, 0o600)
        try:
            subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', 'ship11_staging'],
                           stdout=file, stderr=subprocess.DEVNULL, check=True, timeout=1800)
            file.flush()
            os.fsync(file.fileno())
        except (subprocess.SubprocessError, OSError):
            raise RuntimeError('backup failed; no migration applied') from None
    # Full archive traversal/decompression, not just a non-empty file or TOC check.
    run(['pg_restore', '--list', output])
    run(['pg_restore', '--file=/dev/null', output])
    if output.stat().st_size == 0:
        raise RuntimeError('empty backup')
    print('backup archive verified; restore into an isolated DB remains a separate recovery procedure')


def migrate(release):
    run(['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '-p', 'Type=oneshot',
         '-p', 'WorkingDirectory=' + str(release), '-p', 'EnvironmentFile=' + OPERATOR,
         '-p', 'EnvironmentFile=' + ENV,
         '/usr/bin/node', release / 'scripts/deploy/android-readiness.cjs', 'apply'])
    run(['runuser', '-u', 'postgres', '--', 'psql', '-d', 'ship11_staging', '-v', 'ON_ERROR_STOP=1',
         '-f', release / 'ops/selfhosted/02-runtime-grants.sql'])
    functions = release / 'ops/selfhosted/03-runtime-function-grants.sql'
    if functions.exists():
        run(['runuser', '-u', 'postgres', '--', 'psql', '-d', 'ship11_staging', '-v', 'ON_ERROR_STOP=1', '-f', functions])


def health(release):
    # Retries cover process startup only. Strict HTTPS validation; no curl -k.
    for attempt in range(12):
        try:
            run(['systemctl', 'is-active', SERVICE])
            for suffix in ['/v1/health/ready', '/v1/client-auth/config', '/']:
                response = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '10',
                                '--write-out', '\n%{http_code}', URL + suffix])
                body, status = response.rsplit('\n', 1)
                if status != '200':
                    raise RuntimeError('HTTPS check did not return 200')
                if suffix == '/v1/health/ready' and json.loads(body).get('data', {}).get('status') != 'ready':
                    raise RuntimeError('unexpected readiness response')
                if suffix == '/v1/client-auth/config' and json.loads(body).get('data', {}).get('registration_verification') not in ('REQUIRED', 'NOT_REQUIRED'):
                    raise RuntimeError('unexpected production client auth policy')
                if suffix == '/' and '/js/dom/main.js' not in body:
                    raise RuntimeError('Admin application was not served')
            probe(release)
            return
        except (RuntimeError, ValueError):
            if attempt == 11:
                raise
            time.sleep(2)


def switch(release, old):
    link('current', release)
    try:
        run(['systemctl', 'restart', SERVICE])
        health(release)
    except BaseException:
        link('current', old)
        run(['systemctl', 'restart', SERVICE])
        health(old)
        raise RuntimeError('new release failed; previous code restored and checked; database NOT restored') from None


def update(archive, sha):
    verify_service()
    old = code_release(BASE / 'current')
    new = extract(archive, sha)
    run(['systemctl', 'enable', '--now', '11ship-attestation-refresh.timer'])
    run(['systemctl', 'start', '11ship-attestation-refresh.service'])
    run(['systemctl', 'enable', '--now', '11ship-auth-readiness.timer'])
    probe(old)
    probe(new)
    pending = json.loads(probe(new, 'plan', operator=True))
    compatible(new, pending)
    if pending:
        backup()
        migrate(new)
    if new == old:
        health(new)
        print('already running this release; checked; previous rollback target preserved')
        return
    # Persist rollback target before switching, including if this process is interrupted.
    link('previous', old)
    save_state({'previous': str(old), 'current': str(new), 'backward_compatible': True})
    switch(new, old)
    print('updated and checked; real Android login requires device acceptance')


def save_state(state):
    temporary = BASE / '.deploy-state.new'
    with temporary.open('w') as output:
        json.dump(state, output)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(BASE / 'deploy-state.json')


def rollback():
    verify_service()
    old = code_release(BASE / 'current')
    target = code_release(BASE / 'previous')
    state = json.loads((BASE / 'deploy-state.json').read_text())
    if state != {'previous': str(target), 'current': str(old), 'backward_compatible': True}:
        raise RuntimeError('no compatible rollback record for these releases')
    # No down/restore. All updates using this tool gate migrations for backward compatibility.
    if json.loads(probe(old, 'plan', operator=True)):
        raise RuntimeError('database differs from current release; reconcile before code rollback')
    probe(target)
    switch(target, old)
    link('previous', old)
    save_state({'previous': str(old), 'current': str(target), 'backward_compatible': True})
    print('code rollback complete; database unchanged')


def prune():
    protected = {code_release(BASE / 'current'), code_release(BASE / 'previous')}
    # No automatic deletion: only direct SHA directories, no symlinks, no shared paths.
    for path in (BASE / 'releases').iterdir():
        if path.is_symlink() or not path.is_dir() or not re.fullmatch('[a-f0-9]{40}', path.name) or path.resolve() in protected:
            continue
        # A release with unlisted uploads, mountpoints or altered code is never garbage collected.
        manifest = path / 'MANIFEST.sha256'
        if not manifest.exists():
            raise RuntimeError('unmanaged release; manual inspection required')
        listed = set()
        for line in manifest.read_text().splitlines():
            match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
            if not match or '..' in Path(match[2]).parts or Path(match[2]).is_absolute():
                raise RuntimeError('invalid release manifest')
            listed.add(match[2])
            if digest(path / match[2]) != match[1]:
                raise RuntimeError('modified release; manual inspection required')
        actual = {str(p.relative_to(path)) for p in path.rglob('*') if p.is_file()}
        if actual != listed | {'MANIFEST.sha256'}:
            raise RuntimeError('release contains unlisted data; refusing cleanup')
        mounts = [line.split()[4].replace('\\040', ' ') for line in Path('/proc/self/mountinfo').read_text().splitlines()]
        if any(m == str(path) or m.startswith(str(path) + '/') for m in mounts):
            raise RuntimeError('release contains a mount; refusing cleanup')
        # Reject any symlink inside old code before recursive removal.
        if any(p.is_symlink() for p in path.rglob('*')):
            raise RuntimeError('release contains links; manual inspection required')
        shutil.rmtree(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['update', 'rollback', 'prune'])
    parser.add_argument('archive', nargs='?')
    parser.add_argument('sha', nargs='?')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('run on VPS as root')
    os.umask(0o077)
    BASE.mkdir(exist_ok=True)
    with (BASE / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'update':
            if not args.archive or not re.fullmatch('[a-f0-9]{40}', args.sha or ''):
                raise RuntimeError('update requires archive and full source SHA')
            update(args.archive, args.sha)
        elif args.action == 'rollback':
            rollback()
        else:
            prune()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only fixed application messages; never dump child output/env/tracebacks.
        print('vps-update: ' + (str(error) if type(error) is RuntimeError else 'preflight/operation failed; inspect locally'))
        raise SystemExit(1)
