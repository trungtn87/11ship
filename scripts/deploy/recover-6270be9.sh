#!/usr/bin/env bash
# Run on the existing 11Ship VPS as root. Exact reviewed migrations only.
# Source 6270be903e7c94b5155b3db9a353a7761b864722; no env/keys/DB reset.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run with sudo bash deploy-6270be9.sh'; exit 1; }
python3 -B <<'PY'
import fcntl, hashlib, json, os, stat, tempfile, time
from pathlib import Path
sha = '6270be903e7c94b5155b3db9a353a7761b864722'
base = Path('/opt/11ship')
approved = {
 '1795305600000_service-area-coverage': '1d78c9b015340412dfea60fcb0a073f32684e664caf8b0d640d585915b2a1e78',
 '1795392000000_order-stage-timeouts': 'e3b281687b13f74591a91c39aeb827ac7153efe8973317bf42c0ca2209278f77',
}
policy = Path('/etc/11ship/migration-compatibility.json')
os.umask(0o077)
with (base / '.deploy.lock').open('a') as lock:
 fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
 # Never replay this recovery over a later deployment.
 current = (base / 'current').resolve(strict=True)
 if current.parent != base / 'releases' or current.name not in ('aadde62d08a9a7bc500ff1a50fe84fd2acbd2e74', sha):
  raise SystemExit('STOP: VPS current differs from the last verified deployment; inspect before recovery')
 updater = base / 'tools/vps-update.py'
 if updater.is_symlink() or hashlib.sha256(updater.read_bytes()).hexdigest() != '2d81cf06d7c1b8b21389297db0b460055a7f3309d6ba7b1c1b903a20641d0c4c':
  raise SystemExit('STOP: updater differs from the reviewed release')
 release = base / 'releases' / sha
 for name, expected in approved.items():
  sql = release / 'database/migrations' / (name + '.sql')
  if sql.is_symlink() or hashlib.sha256(sql.read_bytes()).hexdigest() != expected:
   raise SystemExit('STOP: migration content differs: ' + name)
 if policy.exists():
  st = policy.lstat()
  if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
   raise SystemExit('STOP: inspect policy ownership/type/permissions')
  values = json.loads(policy.read_text())
  if not isinstance(values, dict):
   raise SystemExit('STOP: policy must be a JSON object')
  for name, expected in approved.items():
   if name in values and values[name] != expected:
    raise SystemExit('STOP: existing approval conflicts: ' + name)
  backup = policy.with_name(policy.name + '.before-' + time.strftime('%Y%m%dT%H%M%SZ'))
  with backup.open('xb') as out:
   out.write(policy.read_bytes()); out.flush(); os.fsync(out.fileno())
 else:
  values = {}
 values.update(approved)
 fd, temp = tempfile.mkstemp(prefix='.migration-policy-', dir=policy.parent)
 try:
  with os.fdopen(fd, 'w') as out:
   json.dump(values, out, indent=2); out.write('\n'); out.flush(); os.fsync(out.fileno())
  os.chmod(temp, 0o600)
  os.replace(temp, policy)
  directory = os.open(policy.parent, os.O_DIRECTORY)
  try: os.fsync(directory)
  finally: os.close(directory)
 finally:
  if os.path.exists(temp): os.unlink(temp)
 print('Recorded two exact reviewed migration hashes; existing approvals preserved.')
PY
sha=6270be903e7c94b5155b3db9a353a7761b864722
exec python3 -B /opt/11ship/tools/vps-update.py update \
 "/root/11ship-actions/$sha/11ship-$sha-ubuntu24-amd64.tar.gz" "$sha"
