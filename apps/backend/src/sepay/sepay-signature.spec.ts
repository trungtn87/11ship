import { createHmac } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { SEPAY_SIGNATURE_WINDOW_SECONDS, verifySepaySignature } from './sepay-signature';

const SECRET = 'test-only-secret-not-a-real-key';
const NOW = 1_800_000_000;
const BODY = Buffer.from('{"id":92704,"transferAmount":5000000}', 'utf8');

function sign(timestamp: string, body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
}

function verdict(overrides: Partial<{ timestamp: string; signature: string | undefined; body: Buffer; secret: string; now: number }> = {}): string {
  const timestamp = overrides.timestamp ?? String(NOW);
  return verifySepaySignature({
    secret: overrides.secret ?? SECRET,
    timestampHeader: timestamp,
    signatureHeader: 'signature' in overrides ? overrides.signature : sign(timestamp, BODY),
    rawBody: overrides.body ?? BODY,
    nowSeconds: overrides.now ?? NOW,
  });
}

describe('SePay webhook signature (HMAC-SHA256 over timestamp.raw body)', () => {
  it('accepts a correctly signed body inside the window', () => {
    expect(verdict()).toBe('VALID');
  });

  it('accepts uppercase hex in the signature header', () => {
    const timestamp = String(NOW);
    const upper = `sha256=${sign(timestamp, BODY).slice('sha256='.length).toUpperCase()}`;
    expect(verdict({ signature: upper })).toBe('VALID');
  });

  it('refuses a signature made with another secret', () => {
    const timestamp = String(NOW);
    expect(verdict({ signature: sign(timestamp, BODY, 'another-secret') })).toBe('BAD_SIGNATURE');
  });

  it('refuses a body that was changed after signing (a single byte is enough)', () => {
    const changed = Buffer.from('{"id":92704,"transferAmount":5000001}', 'utf8');
    expect(verdict({ body: changed })).toBe('BAD_SIGNATURE');
  });

  it('refuses a re-serialised body: the signature covers the exact bytes, not the parsed JSON', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString('utf8'))).replace('{"id"', '{ "id"'), 'utf8');
    expect(verdict({ body: reserialised })).toBe('BAD_SIGNATURE');
  });

  it('refuses a timestamp that was changed after signing', () => {
    const signedFor = String(NOW);
    expect(verifySepaySignature({ secret: SECRET, timestampHeader: String(NOW + 1), signatureHeader: sign(signedFor, BODY), rawBody: BODY, nowSeconds: NOW + 1 })).toBe('BAD_SIGNATURE');
  });

  it('refuses a signed timestamp older than five minutes', () => {
    const old = String(NOW - SEPAY_SIGNATURE_WINDOW_SECONDS - 1);
    expect(verdict({ timestamp: old, now: NOW })).toBe('EXPIRED');
  });

  it('refuses a signed timestamp more than five minutes in the future', () => {
    const future = String(NOW + SEPAY_SIGNATURE_WINDOW_SECONDS + 1);
    expect(verdict({ timestamp: future, now: NOW })).toBe('EXPIRED');
  });

  it('accepts a timestamp exactly five minutes away in either direction', () => {
    expect(verdict({ timestamp: String(NOW - SEPAY_SIGNATURE_WINDOW_SECONDS), now: NOW })).toBe('VALID');
    expect(verdict({ timestamp: String(NOW + SEPAY_SIGNATURE_WINDOW_SECONDS), now: NOW })).toBe('VALID');
  });

  it('reports missing headers without looking at anything else', () => {
    expect(verdict({ signature: undefined })).toBe('MISSING_HEADERS');
    expect(verifySepaySignature({ secret: SECRET, timestampHeader: undefined, signatureHeader: sign(String(NOW), BODY), rawBody: BODY, nowSeconds: NOW })).toBe('MISSING_HEADERS');
  });

  it('treats a repeated header (array) as missing', () => {
    expect(verifySepaySignature({ secret: SECRET, timestampHeader: [String(NOW)], signatureHeader: sign(String(NOW), BODY), rawBody: BODY, nowSeconds: NOW })).toBe('MISSING_HEADERS');
  });

  it('refuses a signature that is not sha256 with 64 hex characters', () => {
    expect(verdict({ signature: sign(String(NOW), BODY).replace('sha256=', 'md5=') })).toBe('BAD_SIGNATURE');
    expect(verdict({ signature: 'sha256=abcd' })).toBe('BAD_SIGNATURE');
    expect(verdict({ signature: `sha256=${'z'.repeat(64)}` })).toBe('BAD_SIGNATURE');
  });

  it('refuses a timestamp that is not a plain number of seconds', () => {
    expect(verifySepaySignature({ secret: SECRET, timestampHeader: '1800000000.5', signatureHeader: sign('1800000000.5', BODY), rawBody: BODY, nowSeconds: NOW })).toBe('BAD_TIMESTAMP');
    expect(verifySepaySignature({ secret: SECRET, timestampHeader: '-5', signatureHeader: sign('-5', BODY), rawBody: BODY, nowSeconds: NOW })).toBe('BAD_TIMESTAMP');
  });
});
