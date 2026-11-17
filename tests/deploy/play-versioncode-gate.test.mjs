// Guard for the Play submitted-versionCode gate (STORE-01 PR-B, M13.07). Runs in `npm run deploy:test` (ci.yml).
//  1. The committed record mobile/release/play-submitted-versioncode.json has the exact schema and is valid.
//  2. The record never goes DOWN compared with origin/main (a submitted versionCode can never be lowered).
//  3. The gate in mobile/tool/play_versioncode_gate.py refuses equal, lower, missing, malformed, wrong-app and non-integer cases,
//     and accepts a bundle above the record (1.0.0+1 with the empty initial record passes).
//  4. mobile/tool/check-aab-release.py calls the gate, so an AAB at or below the record fails the release check.
// No secret, no Play access. The only network use is fetching origin/main's record in CI-style checks (fail closed if unreachable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RECORD = 'mobile/release/play-submitted-versioncode.json';
const GATE = 'mobile/tool/play_versioncode_gate.py';
const CHECKER = 'mobile/tool/check-aab-release.py';

// CI runners have python3; a Windows dev box may only have `python`. Pick whichever runs.
function python() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
  assert.fail('no python interpreter found (python3 or python)');
}
const PY = python();

const SCHEMA = '11ship.play-submitted-versioncode.v1';
const emptyRecord = () => ({
  schema: SCHEMA,
  rule: 'test record',
  apps: {
    food: { package: 'vn.eleven.food', highest_submitted_version_code: 0, highest_submitted_version_name: null, owner_confirmed_on: null },
    ship: { package: 'vn.eleven.ship', highest_submitted_version_code: 0, highest_submitted_version_name: null, owner_confirmed_on: null },
  },
});
const submittedRecord = (food, ship) => {
  const r = emptyRecord();
  r.apps.food = { package: 'vn.eleven.food', highest_submitted_version_code: food, highest_submitted_version_name: '1.0.0', owner_confirmed_on: '2026-11-20' };
  r.apps.ship = { package: 'vn.eleven.ship', highest_submitted_version_code: ship, highest_submitted_version_name: '1.0.0', owner_confirmed_on: '2026-11-20' };
  return r;
};

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'play-gate-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Run the gate CLI against a record given as a JS value OR as raw text.
function gate(args, record) {
  return withDir(dir => {
    const file = join(dir, 'record.json');
    writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record));
    const r = spawnSync(PY, [GATE, ...args, '--record', file], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  });
}

function gateRaw(args) {
  const r = spawnSync(PY, [GATE, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---- 1. the committed record ----

// Checks the shape of the REAL record only. It does not pin the submitted values: those move forward as Owner confirms uploads.
test('the committed record is valid: schema, rule, package, integer values, and date/name once something is submitted', () => {
  const real = JSON.parse(readFileSync(RECORD, 'utf8'));
  assert.equal(real.schema, SCHEMA);
  assert.match(real.rule, /Owner/);
  assert.match(real.rule, /KHONG|không/, 'the rule says a build or download is not a submission');
  const v = gateRaw(['validate']);
  assert.equal(v.status, 0, v.out);
  for (const app of ['food', 'ship']) {
    const entry = real.apps[app];
    assert.equal(entry.package, `vn.eleven.${app}`);
    const code = entry.highest_submitted_version_code;
    assert.ok(Number.isInteger(code) && code >= 0, `${app}: highest_submitted_version_code is an integer >= 0`);
    if (code > 0) {
      assert.match(entry.highest_submitted_version_name, /^\d+\.\d+\.\d+$/, `${app}: name is MAJOR.MINOR.PATCH`);
      assert.match(entry.owner_confirmed_on, /^\d{4}-\d{2}-\d{2}$/, `${app}: owner_confirmed_on is YYYY-MM-DD`);
    } else {
      assert.equal(entry.highest_submitted_version_name, null, `${app}: nothing submitted, no name`);
      assert.equal(entry.owner_confirmed_on, null, `${app}: nothing submitted, no confirmation date`);
    }
  }
});

test('the committed record and the README tell the same update rule (a separate PR after Owner confirmation)', () => {
  const readme = readFileSync('mobile/release/README.md', 'utf8');
  for (const term of ['play-submitted-versioncode.json', 'PR riêng', 'Owner', 'không giảm', 'vn.eleven.food', 'vn.eleven.ship']) {
    assert.ok(readme.includes(term), `README mentions ${term}`);
  }
});

// ---- 2. the CI guard: no decrease against origin/main ----

test('the record does not decrease compared with origin/main (fresh fetch; fails closed if origin is unreachable)', () => {
  const fetched = spawnSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', 'main'], { encoding: 'utf8' });
  assert.equal(fetched.status, 0, `cannot fetch origin/main to compare the record: ${fetched.stderr}`);
  const base = spawnSync('git', ['show', `FETCH_HEAD:${RECORD}`], { encoding: 'utf8' });
  if (base.status !== 0) {
    // First introduction of the record on main: nothing to compare yet.
    assert.match(base.stderr, /does not exist|exists on disk, but not in/, base.stderr);
    return;
  }
  return withDir(dir => {
    const file = join(dir, 'base.json');
    writeFileSync(file, base.stdout);
    const r = spawnSync(PY, [GATE, 'not-decreased', file, RECORD], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});

test('the not-decreased guard refuses a lowered value and accepts an equal or higher one', () => {
  withDir(dir => {
    const base = join(dir, 'base.json');
    const same = join(dir, 'same.json');
    const lower = join(dir, 'lower.json');
    const higher = join(dir, 'higher.json');
    writeFileSync(base, JSON.stringify(submittedRecord(5, 7)));
    writeFileSync(same, JSON.stringify(submittedRecord(5, 7)));
    writeFileSync(lower, JSON.stringify(submittedRecord(4, 7)));
    writeFileSync(higher, JSON.stringify(submittedRecord(6, 9)));
    const run = f => spawnSync(PY, [GATE, 'not-decreased', base, f], { encoding: 'utf8' });
    assert.equal(run(same).status, 0);
    assert.equal(run(higher).status, 0);
    const bad = run(lower);
    assert.equal(bad.status, 1);
    assert.match(`${bad.stdout}${bad.stderr}`, /food: highest_submitted_version_code fell from 5 to 4/);
  });
});

// ---- 3. the gate ----

test('1.0.0+1 passes against the empty initial record (food and ship)', () => {
  const food = gate(['check', 'food', '1'], emptyRecord());
  assert.equal(food.status, 0, food.out);
  assert.match(food.out, /play versionCode gate ok \(food\): 1 > submitted 0/);
  const ship = gate(['check', 'ship', '1'], emptyRecord());
  assert.equal(ship.status, 0, ship.out);
});

test('a versionCode above the submitted one passes; equal fails; lower fails (per package)', () => {
  const rec = submittedRecord(5, 9);
  assert.equal(gate(['check', 'food', '6'], rec).status, 0);
  const equal = gate(['check', 'food', '5'], rec);
  assert.equal(equal.status, 1);
  assert.match(equal.out, /must be greater than the highest Play-submitted versionCode 5/);
  assert.equal(gate(['check', 'food', '4'], rec).status, 1);
  // ship is gated by its own record: 6 is above food's 5 but below ship's 9
  assert.equal(gate(['check', 'ship', '6'], rec).status, 1, 'ship is not gated by the food value');
  assert.equal(gate(['check', 'ship', '10'], rec).status, 0);
});

test('on a fixture, 1 > 1 is refused: a versionCode equal to the submitted one never passes', () => {
  const rec = submittedRecord(1, 1);
  const r = gate(['check', 'food', '1'], rec);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /must be greater than the highest Play-submitted versionCode 1/);
  assert.equal(gate(['check', 'ship', '1'], rec).status, 1);
  assert.equal(gate(['check', 'food', '2'], rec).status, 0);
});

test('the bundle versionCode must stay within 1..2100000000 (Android ceiling)', () => {
  const rec = submittedRecord(5, 9);
  const over = gate(['check', 'food', '2100000001'], rec);
  assert.equal(over.status, 1, over.out);
  assert.match(over.out, /must be an integer from 1 to 2100000000/);
  const top = gate(['check', 'food', '2100000000'], rec);
  assert.equal(top.status, 0, top.out);
  assert.match(top.out, /play versionCode gate ok \(food\): 2100000000 > submitted 5/);
  assert.equal(gate(['check', 'ship', '2100000000'], rec).status, 0);
  assert.equal(gate(['check', 'ship', '2100000001'], rec).status, 1);
  assert.equal(gate(['check', 'food', '0'], rec).status, 1, 'zero is still refused');
});

test('a missing record file fails the gate', () => {
  const missing = spawnSync(PY, [GATE, 'check', 'food', '1', '--record', join(tmpdir(), 'no-such-play-record-xyz.json')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(`${missing.stdout}${missing.stderr}`, /record is missing/);
});

test('a malformed record (wrong schema, wrong app package, missing key, extra key) fails', () => {
  const wrongSchema = { ...emptyRecord(), schema: 'other/v1' };
  assert.equal(gate(['check', 'food', '1'], wrongSchema).status, 1);

  const swapped = emptyRecord();
  swapped.apps.food.package = 'vn.eleven.ship';
  const swappedRun = gate(['check', 'food', '1'], swapped);
  assert.equal(swappedRun.status, 1);
  assert.match(swappedRun.out, /food: package must be 'vn\.eleven\.food'/);

  const missingKey = emptyRecord();
  delete missingKey.apps.ship.owner_confirmed_on;
  assert.equal(gate(['check', 'ship', '1'], missingKey).status, 1);

  const extraKey = emptyRecord();
  extraKey.apps.food.note = 'x';
  assert.equal(gate(['check', 'food', '1'], extraKey).status, 1);

  const extraApp = emptyRecord();
  extraApp.apps.gateway = extraApp.apps.food;
  assert.equal(gate(['check', 'food', '1'], extraApp).status, 1);

  const noApp = { schema: SCHEMA, rule: 'x' };
  assert.equal(gate(['check', 'food', '1'], noApp).status, 1);
});

test('a submitted record needs a version name and an owner-confirmed date', () => {
  const noName = submittedRecord(3, 3);
  noName.apps.food.highest_submitted_version_name = null;
  assert.equal(gate(['check', 'food', '4'], noName).status, 1);

  const noDate = submittedRecord(3, 3);
  noDate.apps.food.owner_confirmed_on = null;
  assert.equal(gate(['check', 'food', '4'], noDate).status, 1);

  const badDate = submittedRecord(3, 3);
  badDate.apps.food.owner_confirmed_on = '2026-02-30';
  assert.equal(gate(['check', 'food', '4'], badDate).status, 1);

  // Python 3.11+ fromisoformat would accept the compact form; the YYYY-MM-DD regex must refuse it first.
  for (const bad of ['20261120', '2026-11-20T00:00', '2026-11-20\n', ' 2026-11-20', '２０２６-11-20']) {
    const compact = submittedRecord(3, 3);
    compact.apps.food.owner_confirmed_on = bad;
    const r = gate(['check', 'food', '4'], compact);
    assert.equal(r.status, 1, `owner_confirmed_on ${JSON.stringify(bad)} must be refused: ${r.out}`);
    assert.match(r.out, /owner_confirmed_on \(YYYY-MM-DD\) is required/);
  }

  const emptyWithDate = emptyRecord();
  emptyWithDate.apps.food.owner_confirmed_on = '2026-11-20';
  assert.equal(gate(['check', 'food', '1'], emptyWithDate).status, 1, 'nothing submitted must not carry a confirmation date');
});

test('a non-integer submitted value fails (string, float, bool, negative, null, above the Android ceiling)', () => {
  for (const bad of ['"3"', '3.0', 'true', '-1', 'null', '2100000001']) {
    const text = JSON.stringify(emptyRecord()).replace('"highest_submitted_version_code":0', `"highest_submitted_version_code":${bad}`);
    const r = gate(['check', 'food', '1'], text);
    assert.equal(r.status, 1, `value ${bad} must fail: ${r.out}`);
  }
});

test('a duplicate key in the record fails instead of silently taking the last value', () => {
  const dup = '{"schema":"' + SCHEMA + '","rule":"x","apps":{"food":{"package":"vn.eleven.food","highest_submitted_version_code":0,"highest_submitted_version_code":9,"highest_submitted_version_name":null,"owner_confirmed_on":null},"ship":{"package":"vn.eleven.ship","highest_submitted_version_code":0,"highest_submitted_version_name":null,"owner_confirmed_on":null}}}';
  const r = gate(['check', 'food', '1'], dup);
  assert.equal(r.status, 1);
  assert.match(r.out, /duplicate key/);
});

test('a bundle versionCode that is not a positive integer is refused by the gate', () => {
  assert.equal(gate(['check', 'food', '0'], emptyRecord()).status, 1);
  assert.equal(gate(['check', 'food', '1.0'], emptyRecord()).status, 1);
  assert.equal(gate(['check', 'food', 'x'], emptyRecord()).status, 1);
  assert.equal(gate(['check', 'gateway', '2'], emptyRecord()).status, 1, 'only food and ship');
});

// ---- 4. the release checker calls the gate ----

const ANDROID = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const NET = 'android.permission.INTERNET';
const PEER = 'vn.eleven.n11.permission.PEER_ENDORSEMENT';
function foodManifest(code) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest ${ANDROID} package="vn.eleven.food" android:versionCode="${code}" android:versionName="1.0.0">
  <uses-permission android:name="${NET}"/>
  <uses-permission android:name="${PEER}"/>
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/>
</manifest>
`;
}
function runChecker(code) {
  return withDir(dir => {
    const file = join(dir, 'manifest.xml');
    writeFileSync(file, foodManifest(code));
    const r = spawnSync(PY, [CHECKER, 'food', file, '1.0.0', code], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  });
}

// The checker has no record override (it is pinned), so these read the committed food value and test the boundary
// relative to it: value+1 passes, value fails. The numbers stay correct as Owner records new uploads.
const committedFood = () => JSON.parse(readFileSync(RECORD, 'utf8')).apps.food.highest_submitted_version_code;

test('check-aab-release.py passes a versionCode one above the committed record and prints the gate line', () => {
  const submitted = committedFood();
  const r = runChecker(String(submitted + 1));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`play versionCode gate ok \\(food\\): ${submitted + 1} > highest submitted ${submitted}`));
});

test('check-aab-release.py fails a versionCode equal to the committed record', () => {
  const submitted = committedFood();
  const r = runChecker(String(submitted));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /must be greater than the highest Play-submitted versionCode/);
});

test('check-aab-release.py rejects a non-integer versionCode before anything else', () => {
  const r = runChecker('1a');
  assert.equal(r.status, 1, r.out);
});
