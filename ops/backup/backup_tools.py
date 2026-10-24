#!/usr/bin/env python3
"""Small, testable helpers of the backup job (M12-F). No network, no database, no secrets of its own.

  retention   read `rclone lsjson` on stdin, print the file names that fall out of the retention policy (and nothing else)
  classify    read an rclone error text on stdin, print one failure code
  redact      copy stdin to stdout with token/password-looking text removed
  remote      read `rclone lsjson --hash` on stdin, print "size md5" of the named file (exit 1 if absent)
  manifest    print the manifest JSON of a bundle (components with checksums; no secret)

Names the job manages: ship11-<KIND>-<YYYYMMDDTHHMMSSZ>-<8 hex>.tar.enc plus the same name with .manifest.json. Anything else in the folder is never listed for deletion.
"""
import json
import re
import sys

KINDS = ('DAILY', 'WEEKLY', 'PRE_MIGRATION', 'PRE_RESTORE', 'MANUAL')
# How many verified copies of each kind are kept. DAILY and WEEKLY are the Owner's 7 + 4; the newest pre-deploy copy is kept apart so a deploy never pushes a daily or weekly out.
KEEP = {'DAILY': 7, 'WEEKLY': 4, 'PRE_MIGRATION': 1, 'PRE_RESTORE': 2, 'MANUAL': 3}
MAX_DELETE_PER_RUN = 24
NAME = re.compile(r'^ship11-(DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL)-(\d{8}T\d{6}Z)-([0-9a-f]{8})\.(tar\.enc|manifest\.json)$')


def retention(listing, keep=None, protect=()):
    """Names to delete. A copy is one id: its .tar.enc and .manifest.json go together. Only names of this job's own pattern are ever considered, directories are ignored."""
    keep = {**KEEP, **(keep or {})}
    copies = {}
    for entry in listing:
        if entry.get('IsDir'):
            continue
        match = NAME.match(entry.get('Name', ''))
        if match is None:
            continue
        kind, stamp, ident, _ = match.groups()
        copies.setdefault((kind, stamp, ident), []).append(entry['Name'])
    delete = []
    for kind in KINDS:
        ordered = sorted((key for key in copies if key[0] == kind), key=lambda key: (key[1], key[2]), reverse=True)
        kept = 0
        for key in ordered:
            names = copies[key]
            complete = any(name.endswith('.tar.enc') for name in names) and any(name.endswith('.manifest.json') for name in names)
            if key[2] in protect or kept < keep[kind]:
                # An incomplete copy (a bundle without its manifest, or the reverse) does not count as a kept copy: it must not push a good one out.
                if complete:
                    kept += 1
                continue
            delete.extend(sorted(names))
    # A policy bug must never empty the folder: cap the deletions of one run.
    if len(delete) > MAX_DELETE_PER_RUN:
        raise SystemExit('REFUSED: retention would delete %d files (cap %d)' % (len(delete), MAX_DELETE_PER_RUN))
    return delete


CLASSES = (
    ('DRIVE_QUOTA', ('storagequotaexceeded', 'quota', 'insufficient storage', 'no space left', 'storage limit', 'teamdrivefilelimitexceeded')),
    ('DRIVE_AUTH', ('invalid_grant', 'unauthorized', '401', '403', 'insufficientpermissions', 'insufficient permission', 'token expired', 'failed to get oauth token', 'couldn\'t fetch token', 'oauth2', 'forbidden', 'access_denied', 'authorization')),
)


def classify(text):
    low = text.lower()
    for code, needles in CLASSES:
        if any(needle in low for needle in needles):
            return code
    return 'UPLOAD_FAILED'


REDACTIONS = (
    (re.compile(r'(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}'), 'Bearer [removed]'),
    (re.compile(r'ya29\.[A-Za-z0-9._-]+'), '[removed]'),
    (re.compile(r'1//[A-Za-z0-9._-]{20,}'), '[removed]'),
    (re.compile(r'(?i)("?(?:access_token|refresh_token|id_token|client_secret|token|password|passphrase|secret|authorization|api[_-]?key)"?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^\s,;}]+)'), r'\1[removed]'),
    (re.compile(r'(?i)(://[^/\s:@]+:)[^@\s/]+@'), r'\1[removed]@'),
    (re.compile(r'(?i)(-pass(?:word)?\s+)\S+'), r'\1[removed]'),
)


def redact(text):
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def remote_facts(listing, name):
    for entry in listing:
        if entry.get('Name') == name and not entry.get('IsDir'):
            return entry.get('Size'), (entry.get('Hashes') or {}).get('md5') or (entry.get('Hashes') or {}).get('MD5')
    return None


def main(argv):
    command = argv[1] if len(argv) > 1 else ''
    if command == 'retention':
        protect = tuple(argv[2:])
        for name in retention(json.load(sys.stdin), protect=protect):
            print(name)
    elif command == 'classify':
        print(classify(sys.stdin.read()))
    elif command == 'redact':
        sys.stdout.write(redact(sys.stdin.read()))
    elif command == 'remote':
        facts = remote_facts(json.load(sys.stdin), argv[2])
        if facts is None or facts[0] is None or not facts[1]:
            return 1
        print(facts[0], facts[1])
    elif command == 'manifest':
        # manifest <kind> <trigger> <created_at> <release> <commit> <schema> <pg_dump_version> <server_version> <inventory_json> <name:file:...>...
        kind, trigger, created, release, commit, schema, tool, server, inventory = argv[2:11]
        components = []
        for spec in argv[11:]:
            name, size, sha = spec.split(':')
            components.append({'name': name, 'bytes': int(size), 'sha256': sha})
        print(json.dumps({
            'format': 1, 'kind': kind, 'trigger': trigger, 'created_at': created, 'release': release or None, 'commit': commit or None, 'schema_version': schema,
            'pg_dump_version': tool, 'server_version': server, 'components': components, 'storage': json.loads(inventory),
            'consistency': 'database: one pg_dump snapshot (images stored in the database are inside it); extra files: copied after the dump, not point-in-time consistent with it',
        }, sort_keys=True, indent=2))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
