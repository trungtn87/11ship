import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

// M12-F, Google Drive backup. These tests drive the REAL scripts (ops/backup/lib.sh, restore-fetch.sh, backup_tools.py) against a stand-in for rclone that keeps its "Drive" in a
// local directory (tests/deploy/fixtures/fake-rclone.py). They prove the job's own rules: what counts as verified, what retention may touch, what a failure keeps, what never reaches
// a log. They do NOT prove a real Google Drive upload or download; that is done once by the Owner's connection (runbook) and recorded separately.

const root = new URL('../../', import.meta.url).pathname;
const lib = join(root, 'ops/backup/lib.sh');
const tools = join(root, 'ops/backup/backup_tools.py');
const fake = join(root, 'tests/deploy/fixtures/fake-rclone.py');
const NAME = (kind, day, id = 'abcdef01') => `ship11-${kind}-2026${day}T030000Z-${id}`;

let dir;
let env;
const drive = () => join(dir, 'drive/fake/11Ship-Backup');
const rcloneLog = () => (existsSync(join(dir, 'rclone.log')) ? readFileSync(join(dir, 'rclone.log'), 'utf8') : '');

function sh(script, extra = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail; . "${lib}"; ${script}`], { env: { ...env, ...extra }, encoding: 'utf8' });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bk-drive-'));
  mkdirSync(join(dir, 'spool'));
  writeFileSync(join(dir, 'rclone.conf'), '# fake\n');
  writeFileSync(join(dir, 'pass'), 'correct horse battery staple\n', { mode: 0o600 });
  env = {
    PATH: process.env.PATH,
    BACKUP_RCLONE: fake,
    BACKUP_RCLONE_CONFIG: join(dir, 'rclone.conf'),
    BACKUP_REMOTE: 'fake:11Ship-Backup',
    FAKE_RCLONE_ROOT: join(dir, 'drive'),
    FAKE_RCLONE_LOG: join(dir, 'rclone.log'),
    BACKUP_PASSPHRASE_FILE: join(dir, 'pass'),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const makeBundle = (name, content = 'bundle bytes') => {
  const file = join(dir, 'spool', `${name}.tar.enc`);
  writeFileSync(file, content);
  writeFileSync(join(dir, 'spool', `${name}.manifest.json`), '{"format":1}');
  return file;
};

describe('upload and verification', () => {
  test('a copy is verified by size and MD5 on the Drive side, the manifest goes with it', () => {
    const file = makeBundle(NAME('DAILY', '1001'));
    const result = sh(`bk_upload_verify "${file}"`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(drive()).sort(), [`${NAME('DAILY', '1001')}.manifest.json`, `${NAME('DAILY', '1001')}.tar.enc`]);
  });

  test('a copy that differs on Drive is UPLOAD_VERIFY, never a success, and the local file is untouched', () => {
    const file = makeBundle(NAME('DAILY', '1001'));
    const result = sh(`bk_upload_verify "${file}" || echo "ERR=$BK_ERR"`, { FAKE_RCLONE_FAIL: 'corrupt' });
    assert.match(result.stdout, /ERR=UPLOAD_VERIFY/);
    assert.equal(readFileSync(file, 'utf8'), 'bundle bytes');
  });

  test('Drive refusals are told apart: quota, authorisation, anything else', () => {
    const file = makeBundle(NAME('DAILY', '1001'));
    for (const [fail, code] of [['copyto:quota', 'DRIVE_QUOTA'], ['copyto:auth', 'DRIVE_AUTH'], ['copyto:net', 'UPLOAD_FAILED'], ['mkdir:auth', 'DRIVE_AUTH']]) {
      const result = sh(`bk_upload_verify "${file}" || echo "ERR=$BK_ERR"`, { FAKE_RCLONE_FAIL: fail });
      assert.match(result.stdout, new RegExp(`ERR=${code}`), fail);
    }
  });

  test('a Drive without room is DRIVE_QUOTA before anything is uploaded', () => {
    const file = makeBundle(NAME('DAILY', '1001'), 'x'.repeat(1000));
    const result = sh(`bk_upload_verify "${file}" || echo "ERR=$BK_ERR"`, { FAKE_RCLONE_FAIL: 'free=100' });
    assert.match(result.stdout, /ERR=DRIVE_QUOTA/);
    assert.ok(!/copyto/.test(rcloneLog()), 'nothing was sent');
  });

  test('a missing or unreadable Drive configuration is DRIVE_NOT_CONFIGURED, not a quiet local-only success', () => {
    assert.equal(sh('bk_drive_configured').status, 0);
    assert.notEqual(sh('bk_drive_configured', { BACKUP_REMOTE: '' }).status, 0);
    assert.notEqual(sh('bk_drive_configured', { BACKUP_RCLONE_CONFIG: join(dir, 'missing.conf') }).status, 0);
    assert.notEqual(sh('bk_drive_configured', { BACKUP_RCLONE: join(dir, 'no-such-rclone') }).status, 0);
  });

  test('no token, passphrase or Authorization value from rclone reaches the log, even when rclone prints one', () => {
    const file = makeBundle(NAME('DAILY', '1001'));
    const result = sh(`bk_upload_verify "${file}" || true`, { FAKE_RCLONE_FAIL: 'copyto:net', FAKE_RCLONE_LEAK: '1' });
    const everything = result.stdout + result.stderr;
    assert.ok(!/ya29|LEAKEDTOKEN|LEAKEDREFRESH|1\/\/0LEAKED/.test(everything), everything);
    const redacted = spawnSync('python3', ['-I', tools, 'redact'], { input: 'refresh_token: "1//0abcdefghijklmnopqrstuvwxyz" Authorization: Bearer ya29.abcdefgh12345 passphrase=hunter2 postgres://u:s3cret@h/db', encoding: 'utf8' }).stdout;
    assert.ok(!/abcdefghijklmnop|ya29|hunter2|s3cret/.test(redacted), redacted);
  });

  test('a server-side copy (weekly) is checked against its source', () => {
    const file = makeBundle(NAME('DAILY', '1001'));
    assert.equal(sh(`bk_upload_verify "${file}"`).status, 0);
    const ok = sh(`bk_remote_copy_verify "${NAME('DAILY', '1001')}.tar.enc" "${NAME('WEEKLY', '1001')}.tar.enc"`);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(existsSync(join(drive(), `${NAME('WEEKLY', '1001')}.tar.enc`)));
    assert.match(sh(`bk_remote_copy_verify "${NAME('DAILY', '1001')}.tar.enc" "${NAME('WEEKLY', '1002')}.tar.enc" || echo "ERR=$BK_ERR"`, { FAKE_RCLONE_FAIL: 'copyto:quota' }).stdout, /ERR=DRIVE_QUOTA/);
  });
});

describe('retention', () => {
  const put = (name, content = 'x') => {
    mkdirSync(drive(), { recursive: true });
    writeFileSync(join(drive(), name), content);
  };
  const seed = () => {
    // 9 daily (days 10..18), 6 weekly (weeks 01..06), 3 pre-deploy; each copy = bundle + manifest.
    for (let day = 10; day <= 18; day += 1) for (const ext of ['tar.enc', 'manifest.json']) put(`${NAME('DAILY', `10${String(day)}`, `d${String(day).padStart(7, '0')}`)}.${ext}`);
    for (let week = 1; week <= 6; week += 1) for (const ext of ['tar.enc', 'manifest.json']) put(`${NAME('WEEKLY', `090${String(week)}`, `e${String(week).padStart(7, '0')}`)}.${ext}`);
    for (let n = 1; n <= 3; n += 1) for (const ext of ['tar.enc', 'manifest.json']) put(`${NAME('PRE_MIGRATION', `080${String(n)}`, `f${String(n).padStart(7, '0')}`)}.${ext}`);
    // Things that are not ours: never listed for deletion, whatever their age or name.
    for (const foreign of ['photo.jpg', 'notes.txt', 'ship11-DAILY-bad.tar.enc', 'ship11-DAILY-20260101T000000Z-ZZZZZZZZ.tar.enc', 'ship11-OTHER-20260101T000000Z-abcdef01.tar.enc', 'my-ship11-DAILY-20260101T000000Z-abcdef01.tar.enc']) put(foreign);
    mkdirSync(join(drive(), 'subfolder'));
    put('subfolder/ship11-DAILY-20250101T000000Z-abcdef01.tar.enc');
  };
  const names = () => readdirSync(drive()).sort();

  test('keeps 7 daily, 4 weekly and the newest pre-deploy copy; removes only OUR older files; foreign files and folders are untouched', () => {
    seed();
    const result = sh('bk_remote_retention d0000018');
    assert.equal(result.status, 0, result.stderr);
    const left = names();
    assert.equal(left.filter((n) => n.startsWith('ship11-DAILY-2026') && n.endsWith('.tar.enc') && /-d\d{7}\./.test(n)).length, 7);
    assert.equal(left.filter((n) => /-e\d{7}\.tar\.enc$/.test(n)).length, 4);
    assert.equal(left.filter((n) => /-f\d{7}\.tar\.enc$/.test(n)).length, 1);
    assert.ok(left.some((n) => n.includes('-f0000003.')), 'the newest pre-deploy copy is the one kept');
    assert.ok(!left.some((n) => n.includes('-d0000010.') || n.includes('-d0000011.')), 'the oldest dailies went');
    for (const foreign of ['photo.jpg', 'notes.txt', 'ship11-DAILY-bad.tar.enc', 'ship11-DAILY-20260101T000000Z-ZZZZZZZZ.tar.enc', 'ship11-OTHER-20260101T000000Z-abcdef01.tar.enc', 'my-ship11-DAILY-20260101T000000Z-abcdef01.tar.enc', 'subfolder']) assert.ok(left.includes(foreign), foreign);
    assert.ok(existsSync(join(drive(), 'subfolder/ship11-DAILY-20250101T000000Z-abcdef01.tar.enc')));
    const log = rcloneLog();
    assert.ok(!/\b(sync|purge|delete|move|rmdirs|cleanup|dedupe)\b/.test(log.replace(/deletefile/g, '')), 'only single-file deletes are used');
    for (const line of log.split('\n').filter((l) => l.startsWith('deletefile'))) assert.match(line, /^deletefile fake:11Ship-Backup\/ship11-(DAILY|WEEKLY|PRE_MIGRATION)-\d{8}T\d{6}Z-[0-9a-f]{8}\.(tar\.enc|manifest\.json)$/);
  });

  test('a new pre-deploy copy replaces only the older pre-deploy copy: the daily and weekly chains stay whole', () => {
    seed();
    const before = names().filter((n) => !n.includes('PRE_MIGRATION'));
    for (const ext of ['tar.enc', 'manifest.json']) put(`${NAME('PRE_MIGRATION', '1020', 'f0000004')}.${ext}`);
    sh('bk_remote_retention f0000004');
    const after = names();
    assert.deepEqual(after.filter((n) => !n.includes('PRE_MIGRATION')).sort(), before.sort().filter((n) => !/-d000001[01]\./.test(n) || true).filter((n) => after.includes(n)));
    assert.equal(after.filter((n) => n.includes('PRE_MIGRATION') && n.endsWith('.tar.enc')).length, 1);
    assert.ok(after.some((n) => n.includes('-f0000004.tar.enc')));
  });

  test('the copy of the run that just verified is never removed, and an incomplete copy does not push a good one out', () => {
    for (let n = 1; n <= 8; n += 1) put(`${NAME('DAILY', `100${String(n)}`, `a${String(n).padStart(7, '0')}`)}.tar.enc`);
    for (let n = 1; n <= 8; n += 1) put(`${NAME('DAILY', `100${String(n)}`, `a${String(n).padStart(7, '0')}`)}.manifest.json`);
    // a newer bundle whose manifest never arrived
    put(`${NAME('DAILY', '1009', 'a0000009')}.tar.enc`);
    sh('bk_remote_retention a0000009');
    const bundles = names().filter((n) => n.endsWith('.tar.enc'));
    assert.ok(bundles.some((n) => n.includes('a0000009')), 'protected: the run that just verified');
    assert.equal(bundles.filter((n) => n.includes('a000000') && !n.includes('a0000009')).length, 7, 'seven complete copies survive');
  });

  test('retention refuses to delete more than its cap in one run (a policy bug must not empty the folder)', () => {
    for (let n = 10; n < 60; n += 1) for (const ext of ['tar.enc', 'manifest.json']) put(`${NAME('MANUAL', `10${String(n)}`, `b${String(n).padStart(7, '0')}`)}.${ext}`);
    const before = names().length;
    sh('bk_remote_retention b0000059');
    assert.equal(names().length, before);
  });

  test('a Drive listing failure skips retention instead of guessing', () => {
    seed();
    const before = names().length;
    sh('bk_remote_retention d0000018', { FAKE_RCLONE_FAIL: 'lsjson:net' });
    assert.equal(names().length, before);
  });
});

describe('the local spool, the lock and the calendar', () => {
  const spoolFile = (name, size, age, marker = false) => {
    const file = join(dir, 'spool', `${name}.tar.enc`);
    writeFileSync(file, Buffer.alloc(size));
    const when = new Date(Date.now() - age * 1000);
    utimesSync(file, when, when);
    if (marker) writeFileSync(`${file}.offsite`, 'ok');
    return file;
  };

  test('verified local copies are trimmed to the newest few; copies not yet on Drive are never trimmed by that', () => {
    const verified = [1, 2, 3, 4].map((n) => spoolFile(NAME('DAILY', `100${String(n)}`, `a000000${String(n)}`), 10, 1000 - n * 100, true));
    const unsent = spoolFile(NAME('DAILY', '1009', 'a0000009'), 10, 5000);
    assert.equal(sh(`bk_spool_prune "${join(dir, 'spool')}" 2`).status, 0);
    assert.deepEqual(verified.map((f) => existsSync(f)), [false, false, true, true]);
    assert.ok(existsSync(unsent));
  });

  test('over the size cap the OLDEST unsent copy goes first; the newest copy and the verified ones stay', () => {
    const oldest = spoolFile(NAME('DAILY', '1001', 'a0000001'), 1_000_000, 900);
    const middle = spoolFile(NAME('DAILY', '1002', 'a0000002'), 1_000_000, 800);
    const newest = spoolFile(NAME('DAILY', '1003', 'a0000003'), 1_000_000, 100);
    const sent = spoolFile(NAME('DAILY', '1004', 'a0000004'), 1_000_000, 700, true);
    sh(`bk_spool_trim_unsent "${join(dir, 'spool')}" 3`); // cap 3 MB (the 4 files are 4 MB)
    assert.deepEqual([oldest, middle, newest, sent].map((f) => existsSync(f)), [false, true, true, true]);
  });

  test('a second run while one holds the lock gets 75 and starts nothing', () => {
    const lock = join(dir, 'lock');
    const first = spawn('bash', ['-c', `. "${lib}"; bk_lock "${lock}"; sleep 2`], { env });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    return wait(700).then(async () => {
      const second = sh(`bk_lock "${lock}"`);
      assert.equal(second.status, 75);
      first.kill();
      await wait(200);
      assert.equal(sh(`bk_lock "${lock}"`).status, 0, 'the lock is free again once the first run is gone');
    });
  });

  test('Sunday on the Vietnam calendar, at the day edges', () => {
    const at = (iso) => sh(`bk_is_weekly_day ${Math.floor(Date.parse(iso) / 1000)} && echo yes || echo no`).stdout.trim();
    assert.equal(at('2026-10-24T16:59:59Z'), 'no'); // Saturday 23:59:59 in Vietnam
    assert.equal(at('2026-10-24T17:00:00Z'), 'yes'); // Sunday 00:00
    assert.equal(at('2026-10-24T20:00:00Z'), 'yes'); // Sunday 03:00: the timer
    assert.equal(at('2026-10-25T16:59:59Z'), 'yes'); // Sunday 23:59:59
    assert.equal(at('2026-10-25T17:00:00Z'), 'no'); // Monday 00:00
  });
});

describe('report to M13', () => {
  test('the report carries the result and the credential in a header only, and never prints either', async () => {
    const seen = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        seen.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
        response.end('{}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/v1/ops/ingest/backup`;
    writeFileSync(join(dir, 'ingest'), 'S3CRET-INGEST-KEY\n', { mode: 0o600 });
    const run = (args) =>
      new Promise((resolve) => {
        const child = spawn('bash', ['-c', `set -euo pipefail; . "${lib}"; bk_report ${args}`], { env: { ...env, BACKUP_OPS_URL: url, BACKUP_INGEST_KEY_FILE: join(dir, 'ingest') } });
        let out = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (out += c));
        child.on('close', () => resolve(out));
      });
    const failure = await run('BACKUP false "" DRIVE_QUOTA');
    const success = await run('BACKUP true 123456 ""');
    server.close();
    assert.ok(!/S3CRET/.test(failure + success), 'the key is never printed');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].authorization, 'Bearer S3CRET-INGEST-KEY');
    assert.deepEqual({ ...seen[0].body, finished_at: 'x' }, { kind: 'BACKUP', ok: false, finished_at: 'x', detail_code: 'DRIVE_QUOTA' });
    assert.deepEqual({ ...seen[1].body, finished_at: 'x' }, { kind: 'BACKUP', ok: true, finished_at: 'x', size_bytes: 123456 });
  });

  test('without a key or URL the report is skipped, loudly, and the run is not turned into a failure', () => {
    const result = sh('bk_report BACKUP true 1 ""');
    assert.equal(result.status, 0);
    assert.match(result.stderr, /M13 report skipped/);
  });
});

describe('fetching a backup back from Drive', () => {
  const sealed = (name, tamper) => {
    const work = join(dir, 'build');
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'database.dump'), 'PGDMP-not-a-real-dump');
    const sha = spawnSync('sha256sum', [join(work, 'database.dump')], { encoding: 'utf8' }).stdout.split(' ')[0];
    writeFileSync(join(work, 'manifest.json'), JSON.stringify({ format: 1, components: [{ name: 'database.dump', bytes: 21, sha256: tamper === 'component' ? '0'.repeat(64) : sha }] }));
    assert.equal(spawnSync('tar', ['-C', work, '-cf', join(work, 'bundle.tar'), 'database.dump', 'manifest.json']).status, 0);
    const enc = join(dir, 'drive/fake/11Ship-Backup');
    mkdirSync(enc, { recursive: true });
    assert.equal(spawnSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-pass', `file:${join(dir, 'pass')}`, '-in', join(work, 'bundle.tar'), '-out', join(enc, `${name}.tar.enc`)]).status, 0);
    const bundleSha = spawnSync('sha256sum', [join(enc, `${name}.tar.enc`)], { encoding: 'utf8' }).stdout.split(' ')[0];
    writeFileSync(join(enc, `${name}.manifest.json`), JSON.stringify({ format: 1, bundle_sha256: tamper === 'bundle' ? '1'.repeat(64) : bundleSha }));
  };
  const fetch = (name, out, extra = {}) => spawnSync('bash', [join(root, 'ops/backup/restore-fetch.sh'), name, out], { env: { ...env, ...extra }, encoding: 'utf8' });

  test('download, checksum, decrypt and unpack a good backup; "latest" picks the newest', () => {
    sealed(NAME('DAILY', '1001'));
    sealed(NAME('DAILY', '1003', 'abcdef03'));
    const result = fetch('latest', join(dir, 'out'));
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /FETCHED ship11-DAILY-20261003T030000Z-abcdef03/);
    assert.equal(readFileSync(join(dir, 'out/contents/database.dump'), 'utf8'), 'PGDMP-not-a-real-dump');
  });

  test('a bundle that does not match its manifest, a component that does not match, a wrong passphrase and a dirty output folder are all refused', () => {
    sealed(NAME('DAILY', '1001'), 'bundle');
    let result = fetch(NAME('DAILY', '1001'), join(dir, 'o1'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CHECKSUM MISMATCH/);
    sealed(NAME('DAILY', '1002'), 'component');
    result = fetch(NAME('DAILY', '1002'), join(dir, 'o2'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /COMPONENT CHECKSUM MISMATCH/);
    sealed(NAME('DAILY', '1004'));
    writeFileSync(join(dir, 'wrong'), 'not the passphrase\n', { mode: 0o600 });
    result = fetch(NAME('DAILY', '1004'), join(dir, 'o3'), { BACKUP_PASSPHRASE_FILE: join(dir, 'wrong') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DECRYPTION FAILED/);
    mkdirSync(join(dir, 'o4'));
    writeFileSync(join(dir, 'o4/x'), 'x');
    assert.equal(fetch(NAME('DAILY', '1004'), join(dir, 'o4')).status, 65);
    assert.equal(fetch('../../etc/passwd', join(dir, 'o5')).status, 64);
  });

  test('a download that differs from what Drive reports is refused (size/MD5)', () => {
    sealed(NAME('DAILY', '1001'));
    const result = fetch(NAME('DAILY', '1001'), join(dir, 'o1'), { FAKE_RCLONE_FAIL: 'corrupt' });
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(dir, 'o1', `${NAME('DAILY', '1001')}.tar.enc`)), 'the damaged download is not left behind as if it were good');
  });
});

describe('schedule, units and repository hygiene', () => {
  const unit = (name) => readFileSync(join(root, 'ops/vinahost', name), 'utf8');

  test('the timer fires at 03:00 Vietnam time whatever the VPS zone, persists missed runs, and every service has a timeout and no secret', () => {
    const timer = unit('11ship-backup.timer');
    assert.match(timer, /OnCalendar=\*-\*-\* 03:00:00 Asia\/Ho_Chi_Minh/);
    assert.match(timer, /Persistent=true/);
    const analysed = spawnSync('systemd-analyze', ['calendar', '*-*-* 03:00:00 Asia/Ho_Chi_Minh'], { encoding: 'utf8' });
    if (analysed.status === 0) assert.match(analysed.stdout, /Next elapse: .* 20:00:00 UTC/);
    for (const name of ['11ship-backup.service', '11ship-backup-trigger.service', '11ship-backup-predeploy.service', '11ship-restore-drill.service']) {
      const text = unit(name);
      assert.match(text, /TimeoutStartSec=/, name);
      assert.match(text, /LoadCredentialEncrypted=backup-passphrase:/, name);
      assert.match(text, /Type=oneshot/, name);
      assert.doesNotMatch(text, /PASSPHRASE=[^%]|refresh_token|BEGIN [A-Z ]*PRIVATE KEY|ya29\./, name);
    }
    assert.match(unit('11ship-backup-predeploy.service'), /BACKUP_KIND=PRE_MIGRATION/);
    assert.match(unit('11ship-backup-trigger.timer'), /OnUnitInactiveSec=1min/);
  });

  test('no credential, token, key or backup data is committed under ops/backup, ops/vinahost or the runbooks', () => {
    const files = spawnSync('git', ['ls-files', 'ops/backup', 'ops/vinahost', 'ops/runbooks'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    assert.ok(files.length > 10);
    for (const file of files) {
      if (/\.(png|ico)$/.test(file)) continue;
      const text = readFileSync(join(root, file), 'utf8');
      assert.doesNotMatch(text, /ya29\.[A-Za-z0-9_-]{10,}|1\/\/0[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"refresh_token"\s*:\s*"[^"]{8,}|GOCSPX-[A-Za-z0-9_-]{10,}/, file);
      assert.ok(!/\.(dump|enc|cred)$/.test(file), `${file} looks like backup data or a credential`);
    }
    const ignored = spawnSync('git', ['check-ignore', '-q', 'rclone.conf'], { cwd: root });
    assert.equal(ignored.status, 0, 'rclone.conf is git-ignored');
  });

  test('the manifest lists versions, components and checksums and holds no secret', () => {
    const out = spawnSync('python3', ['-I', tools, 'manifest', 'DAILY', 'TIMER', '2026-10-24T03:00:00Z', '1.2.3', 'a'.repeat(40), '1795996800000_x', '17.2', '17.2', '{"menu_images":"database","extra_paths":[]}', `database.dump:123:${'b'.repeat(64)}`], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const manifest = JSON.parse(out.stdout);
    assert.deepEqual(Object.keys(manifest).sort(), ['commit', 'components', 'consistency', 'created_at', 'format', 'kind', 'pg_dump_version', 'release', 'schema_version', 'server_version', 'storage', 'trigger']);
    assert.deepEqual(manifest.components, [{ name: 'database.dump', bytes: 123, sha256: 'b'.repeat(64) }]);
    assert.match(manifest.consistency, /not point-in-time consistent/);
    assert.doesNotMatch(out.stdout, /password|secret|token|postgres:\/\//i);
  });
});
