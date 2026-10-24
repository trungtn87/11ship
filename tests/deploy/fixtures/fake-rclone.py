#!/usr/bin/env python3
"""A stand-in for rclone used by the tests. It speaks only the commands the backup job uses (about, mkdir, copyto, lsjson, deletefile) against a local directory that plays
"Google Drive". It is NOT Google Drive: tests with it prove the job's own logic (verification, retention, retries, redaction), not the real upload.

  FAKE_RCLONE_ROOT   directory that holds the remote(s): <root>/<remote name>/<path>
  FAKE_RCLONE_LOG    file that receives one line per call (the command and its non-secret arguments)
  FAKE_RCLONE_FAIL   comma list: <command>:<quota|auth|net> to fail a command, corrupt (truncate each uploaded file by one byte), free=<bytes> (the Drive reports that much room)
  FAKE_RCLONE_LEAK   when set, a failure also prints token-looking text, to prove the job redacts it
"""
import hashlib
import json
import os
import shutil
import sys

args = sys.argv[1:]
config = None
rest = []
i = 0
while i < len(args):
    if args[i] == '--config':
        config = args[i + 1]
        i += 2
        continue
    rest.append(args[i])
    i += 1
if config is None or not os.path.exists(config):
    print("Failed to create file system: didn't find section in config file", file=sys.stderr)
    sys.exit(3)
root = os.environ['FAKE_RCLONE_ROOT']
fails = [x for x in os.environ.get('FAKE_RCLONE_FAIL', '').split(',') if x]
with open(os.environ.get('FAKE_RCLONE_LOG', os.devnull), 'a') as log:
    log.write(' '.join(rest) + '\n')
command = rest[0]
flags = [x for x in rest[1:] if x.startswith('--')]
positional = [x for x in rest[1:] if not x.startswith('--')]


def remote_path(spec):
    name, _, path = spec.partition(':')
    return os.path.join(root, name, path)


def fail(kind):
    messages = {
        'quota': 'Failed to copy: googleapi: Error 403: The user\'s Drive storage quota has been exceeded., storageQuotaExceeded',
        'auth': 'Failed to create file system: couldn\'t fetch token: invalid_grant: Token has been expired or revoked.',
        'net': 'Failed to copy: Post "https://www.googleapis.com/upload/drive/v3/files": dial tcp: i/o timeout',
    }
    print(messages[kind], file=sys.stderr)
    if os.environ.get('FAKE_RCLONE_LEAK'):
        print('debug: Authorization: Bearer ya29.A0LEAKEDTOKENVALUE0123456789 refresh_token: "1//0LEAKEDREFRESHTOKENVALUE012345678"', file=sys.stderr)
    sys.exit(1)


for item in fails:
    cmd, _, kind = item.partition(':')
    if cmd == command and kind in ('quota', 'auth', 'net'):
        fail(kind)

if command == 'about':
    free = next((int(x.split('=')[1]) for x in fails if x.startswith('free=')), 10 ** 12)
    print(json.dumps({'total': free * 2, 'used': free, 'free': free}))
elif command == 'mkdir':
    os.makedirs(remote_path(positional[0]), exist_ok=True)
elif command == 'copyto':
    src, dst = positional
    source = remote_path(src) if ':' in src and not os.path.exists(src) else src
    target = remote_path(dst) if ':' in dst and not os.path.isabs(dst) else dst
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copyfile(source, target)
    if 'corrupt' in fails:
        with open(target, 'r+b') as handle:
            data = handle.read()
            handle.seek(0)
            handle.truncate()
            handle.write(data[:-1])
elif command == 'lsjson':
    directory = remote_path(positional[0])
    entries = []
    if os.path.isdir(directory):
        for name in sorted(os.listdir(directory)):
            path = os.path.join(directory, name)
            entry = {'Name': name, 'Path': name, 'IsDir': os.path.isdir(path)}
            if not entry['IsDir']:
                entry['Size'] = os.path.getsize(path)
                if '--hash' in flags:
                    entry['Hashes'] = {'md5': hashlib.md5(open(path, 'rb').read()).hexdigest()}
            elif '--files-only' in flags:
                continue
            entries.append(entry)
    print(json.dumps(entries))
elif command == 'deletefile':
    os.remove(remote_path(positional[0]))
else:
    print('unsupported command ' + command, file=sys.stderr)
    sys.exit(2)
