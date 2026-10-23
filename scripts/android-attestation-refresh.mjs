#!/usr/bin/env node
// Refreshes the Android attestation REVOCATION snapshot the service reads (CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE).
//
//   node scripts/android-attestation-refresh.mjs <output-file>
//
// It downloads the official Android attestation status list over verified HTTPS (the OS trust store; there is no option to turn the
// verification off), validates its shape, and writes {fetched_at, entries} ATOMICALLY (temp file + rename) with mode 0640. Any failure
// (network, status, size, shape) exits non-zero and leaves the previous file untouched: the server then treats a snapshot older than
// 24 hours as "not ready" (503) instead of trusting a stale list, which is the honest outcome. The service re-reads the file when it
// changes, so no restart is needed. Writes no log of the list; the only output is one line per run.
import { chmodSync, closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATUS_URL = 'https://android.googleapis.com/attestation/status';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Returns the {fetched_at, entries} document for an official status body, or throws a fixed message. */
export function toSnapshot(body, nowMs) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('the status list is not JSON');
  }
  const entries = parsed?.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error('the status list has no entries object');
  }
  const out = {};
  for (const [serial, entry] of Object.entries(entries)) {
    if (!/^[0-9a-f]{1,64}$/.test(serial) || typeof entry !== 'object' || entry === null || typeof entry.status !== 'string') {
      throw new Error('the status list has an unexpected entry');
    }
    out[serial] = { status: entry.status };
  }
  return { fetched_at: new Date(nowMs).toISOString(), entries: out };
}

export async function refresh(outputFile, { fetchImpl = fetch, now = Date.now, url = STATUS_URL } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (response.status !== 200) {
    throw new Error(`the status server answered ${String(response.status)}`);
  }
  let body;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('the status list is too large');
        chunks.push(Buffer.from(value));
      }
      body = Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel().catch(() => {});
    }
  } else {
    body = await response.text();
  }
  if (body.length > MAX_BYTES) {
    throw new Error('the status list is too large');
  }
  const snapshot = toSnapshot(body, now());
  const work = mkdtempSync(join(dirname(outputFile), '.attestation-revocation.'));
  const temp = join(work, 'snapshot');
  try {
    writeFileSync(temp, `${JSON.stringify(snapshot)}\n`, { mode: 0o640, flag: 'wx' });
    chmodSync(temp, 0o640);
    const fd = openSync(temp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, outputFile);
    const directory = openSync(dirname(outputFile), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return Object.keys(snapshot.entries).length;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (output === undefined || process.argv.length !== 3) {
    console.error('usage: node scripts/android-attestation-refresh.mjs <output-file>');
    process.exit(2);
  }
  refresh(output).then(
    (count) => console.log(`android-attestation-refresh: wrote ${String(count)} entries`),
    () => {
      let age = 'unreadable';
      try {
        age = `${Math.floor((Date.now() - Date.parse(JSON.parse(readFileSync(output, 'utf8')).fetched_at)) / 3600000)}h`;
      } catch { /* keep fixed unreadable label */ }
      console.error(`android-attestation-refresh: failed; last snapshot age=${age}; inspect network, permissions and timer. No stale fallback.`);
      process.exit(1);
    },
  );
}
