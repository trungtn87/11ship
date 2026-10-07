import { describe, expect, it } from '@jest/globals';
import { CryptoError } from '../crypto/crypto-error';
import { parseRecordRow } from './idempotency-record';

function validRow(): Record<string, unknown> {
  return {
    record_id: '0b8f4c2e-1d7a-4c35-9a52-6c1c9a7f2a11',
    scope_type: 'verification_proof',
    scope_id: 'p1',
    operation_id: 'auth.register.v1',
    idempotency_key: '3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34',
    request_fingerprint: 'a'.repeat(64),
    crypto_key_id: 'k1',
    response_status: 201,
    replay_format_version: 1,
    replay_guard: { proof_id: 'p1' },
    replay_ciphertext: Buffer.from([1, 2, 3]),
    replay_iv: Buffer.alloc(12, 7),
    replay_tag: Buffer.alloc(16, 9),
    // pg returns bigint as a decimal string
    created_at_ms: '1791344784669',
    replay_expires_at_ms: '1791344884668',
    dedupe_expires_at_ms: '1791344889669',
  };
}

function reasonOf(row: Record<string, unknown>): string {
  try {
    parseRecordRow(row);
  } catch (error) {
    if (error instanceof CryptoError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('expected the row to be refused');
}

describe('parseRecordRow', () => {
  it('maps a driver row, converting bigint strings to epoch milliseconds', () => {
    const record = parseRecordRow(validRow());
    expect(record.recordId).toBe('0b8f4c2e-1d7a-4c35-9a52-6c1c9a7f2a11');
    expect(record.scopeType).toBe('verification_proof');
    expect(record.responseStatus).toBe(201);
    expect(record.replayFormatVersion).toBe(1);
    expect(record.createdAtMs).toBe(1791344784669);
    expect(record.replayExpiresAtMs).toBe(1791344884668);
    expect(record.dedupeExpiresAtMs).toBe(1791344889669);
    expect(record.replayGuard).toEqual({ proof_id: 'p1' });
    expect(record.replayCiphertext?.length).toBe(3);
  });

  it('accepts a tombstone: all three replay columns NULL', () => {
    const record = parseRecordRow({
      ...validRow(),
      replay_ciphertext: null,
      replay_iv: null,
      replay_tag: null,
    });
    expect(record.replayCiphertext).toBeNull();
    expect(record.replayIv).toBeNull();
    expect(record.replayTag).toBeNull();
  });

  const corrupt: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['record_id is not text', { record_id: 5 }],
    ['scope_id missing', { scope_id: undefined }],
    ['response_status is text', { response_status: 'two hundred' }],
    ['response_status is fractional', { response_status: 201.5 }],
    ['an expiry is not a number', { replay_expires_at_ms: 'soon' }],
    ['an expiry is NaN', { dedupe_expires_at_ms: Number.NaN }],
    ['ciphertext is text', { replay_ciphertext: 'abc' }],
    ['iv is a plain array', { replay_iv: [1, 2, 3] }],
    ['tag is a number', { replay_tag: 5 }],
  ];
  for (const [label, override] of corrupt) {
    it(`fails closed (invalid_envelope) when ${label}`, () => {
      expect(reasonOf({ ...validRow(), ...override })).toBe('invalid_envelope');
    });
  }

  it('never puts a value of the row into the error', () => {
    const marker = 'SECRET_MARKER_ROW_5d2e';
    try {
      parseRecordRow({ ...validRow(), scope_id: 42, crypto_key_id: marker, request_fingerprint: marker });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(marker);
      return;
    }
    throw new Error('expected the row to be refused');
  });
});
