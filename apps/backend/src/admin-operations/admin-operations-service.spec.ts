import { describe, expect, it } from '@jest/globals';
import { BackupRow } from './admin-operations-repository';
import { backupHealth, redact } from './admin-operations-service';

const NOW = Date.parse('2026-10-24T03:00:00Z');
const HOUR = 3_600_000;

const row = (over: Partial<BackupRow>): BackupRow => ({
  backupId: 'b', kind: 'DAILY', state: 'SUCCEEDED', startedAtMs: NOW - HOUR, finishedAtMs: NOW - HOUR + 60_000, sizeBytes: 100, schemaVersion: 'x', encrypted: true, offsite: true, verifiedAtMs: NOW - HOUR + 120_000, verifyNote: null, errorCode: null, stage: 'VERIFIED', failedStage: null, trigger: 'TIMER', releaseVersion: null, offsiteVerifiedAtMs: NOW - HOUR + 180_000, ...over,
});

describe('backupHealth', () => {
  it('says NONE when nothing verified exists, whatever else is recorded', () => {
    expect(backupHealth([], NOW).state).toBe('NONE');
    expect(backupHealth([row({ state: 'FAILED', verifiedAtMs: null, errorCode: 'X' }), row({ state: 'RUNNING', verifiedAtMs: null }), row({ verifiedAtMs: null }), row({ encrypted: false })], NOW)).toMatchObject({ state: 'NONE', last_verified_at: null });
  });

  it('is OK only for a recent, verified, encrypted copy that is off the VPS', () => {
    expect(backupHealth([row({})], NOW).state).toBe('OK');
    expect(backupHealth([row({ offsite: false })], NOW).state).toBe('NOT_OFFSITE');
    expect(backupHealth([row({ verifiedAtMs: NOW - 27 * HOUR })], NOW).state).toBe('STALE');
    expect(backupHealth([row({ verifiedAtMs: NOW - 26 * HOUR + 1000 })], NOW).state).toBe('OK');
  });

  it('judges by the newest OFF-VPS copy, not by a newer copy that stays on the VPS', () => {
    const health = backupHealth([row({ offsite: false, verifiedAtMs: NOW - HOUR }), row({ offsite: true, verifiedAtMs: NOW - 30 * HOUR })], NOW);
    expect(health.state).toBe('STALE');
  });
});

describe('redact', () => {
  it('hides the value of secret-looking keys at any depth and shortens long text', () => {
    const out = redact({ ok: 1, password: 'p', nested: { api_key: 'k', session_token: 't', otp_code: '1', fine: 'x' }, list: [{ secret: 's' }], long: 'y'.repeat(400), account_number: '123' }) as Record<string, unknown>;
    expect(out.ok).toBe(1);
    expect(out.password).toBe('[đã ẩn]');
    expect(out.nested).toEqual({ api_key: '[đã ẩn]', session_token: '[đã ẩn]', otp_code: '[đã ẩn]', fine: 'x' });
    expect(out.list).toEqual([{ secret: '[đã ẩn]' }]);
    expect((out.long as string).length).toBe(301);
    expect(out.account_number).toBe('[đã ẩn]');
  });

  it('stops at a depth limit instead of recursing without end', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 20; i++) {
      value = { a: value };
    }
    expect(JSON.stringify(redact(value))).toContain('[đã ẩn]');
  });
});
