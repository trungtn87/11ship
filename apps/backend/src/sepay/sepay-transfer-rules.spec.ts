import { describe, expect, it } from '@jest/globals';
import { parseSepayEvent, SepayTransferEvent } from './sepay-event';
import { decideTransfer } from './sepay-transfer-rules';

const VALID_BODY = {
  id: 92704,
  gateway: 'MBBank',
  transactionDate: '2026-11-19 11:08:33',
  accountNumber: '0123456789',
  subAccount: '',
  code: 'NAPA1B2C3D4E5',
  content: 'NAPA1B2C3D4E5 chuyen tien',
  transferType: 'in',
  description: 'full bank description',
  transferAmount: 150000,
  accumulated: 0,
  referenceCode: 'FT24012345678',
};

function event(overrides: Partial<Record<string, unknown>> = {}): SepayTransferEvent {
  const parsed = parseSepayEvent({ ...VALID_BODY, ...overrides });
  if (parsed === undefined) {
    throw new Error('fixture must parse');
  }
  return parsed;
}

describe('SePay payload validation', () => {
  it('parses the documented shape and keeps the Vietnam time as +07:00', () => {
    const parsed = event();
    expect(parsed).toMatchObject({ webhookEventId: 92704, transferAmountVnd: 150000, transferType: 'in', code: 'NAPA1B2C3D4E5', referenceCode: 'FT24012345678' });
    expect(parsed.transactionAtIso).toBe('2026-11-19T11:08:33+07:00');
    expect(parsed).not.toHaveProperty('description');
    expect(parsed).not.toHaveProperty('accumulated');
  });

  it('keeps null and empty code as different facts', () => {
    expect(event({ code: null }).code).toBeNull();
    expect(event({ code: '' }).code).toBe('');
  });

  it.each([
    ['a string id (SePay sends an integer)', { id: '92704' }],
    ['a zero or negative id', { id: 0 }],
    ['a fractional id', { id: 1.5 }],
    ['a fractional amount', { transferAmount: 150000.5 }],
    ['a zero amount', { transferAmount: 0 }],
    ['an unknown transfer type', { transferType: 'credit' }],
    ['a date without seconds', { transactionDate: '2026-11-19 11:08' }],
    ['an impossible date', { transactionDate: '2026-13-40 11:08:33' }],
    ['an empty account number', { accountNumber: '' }],
    ['content longer than 2000 characters', { content: 'x'.repeat(2001) }],
    ['a missing reference field', { referenceCode: undefined }],
    ['a code that is not a string or null', { code: 42 }],
  ])('refuses %s', (_name, override) => {
    expect(parseSepayEvent({ ...VALID_BODY, ...override })).toBeUndefined();
  });

  it('refuses a non-object body', () => {
    expect(parseSepayEvent(null)).toBeUndefined();
    expect(parseSepayEvent([VALID_BODY])).toBeUndefined();
    expect(parseSepayEvent('{}')).toBeUndefined();
  });
});

describe('SePay transfer decision (pure matching rule)', () => {
  it('makes a candidate only when the code opens the content and the reference is present', () => {
    const decision = decideTransfer(event());
    expect(decision).toEqual({ kind: 'CANDIDATE', transferCode: 'NAPA1B2C3D4E5', canonicalTransactionId: 'FT24012345678' });
  });

  it('ignores leading whitespace of the bank content and nothing else', () => {
    expect(decideTransfer(event({ content: '   NAPA1B2C3D4E5 ok' })).kind).toBe('CANDIDATE');
    expect(decideTransfer(event({ content: 'hello NAPA1B2C3D4E5' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'CODE_NOT_AT_START' });
  });

  it('accepts the bank prefix "<BANK> <account> " that MB puts before the customer text', () => {
    expect(decideTransfer(event({ content: 'MB 868111247 NAPA1B2C3D4E5- Ma GD ACSP/ UY017650' })).kind).toBe('CANDIDATE');
    expect(decideTransfer(event({ content: 'MB 868111247 hello NAPA1B2C3D4E5' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'CODE_NOT_AT_START' });
  });

  it('holds money with no code (null or empty) for an Administrator', () => {
    expect(decideTransfer(event({ code: null }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'NO_CODE' });
    expect(decideTransfer(event({ code: '' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'NO_CODE' });
  });

  it('holds a code that is not the exact NAP + 10 upper-case hex shape', () => {
    expect(decideTransfer(event({ code: 'napa1b2c3d4e5', content: 'napa1b2c3d4e5' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'CODE_FORMAT' });
    expect(decideTransfer(event({ code: 'NAPA1B2C3D4E', content: 'NAPA1B2C3D4E' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'CODE_FORMAT' });
    expect(decideTransfer(event({ code: 'NAPA1B2C3D4E5X', content: 'NAPA1B2C3D4E5X' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'CODE_FORMAT' });
  });

  it('holds money without a bank reference (no safe canonical identity)', () => {
    expect(decideTransfer(event({ referenceCode: '' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'NO_REFERENCE' });
    expect(decideTransfer(event({ referenceCode: 'FT 2401 2345' }))).toEqual({ kind: 'NEEDS_ADMIN', reason: 'REFERENCE_FORMAT' });
  });

  it('never makes a candidate from outbound money', () => {
    expect(decideTransfer(event({ transferType: 'out' }))).toEqual({ kind: 'IGNORED', reason: 'OUTBOUND_TRANSFER' });
  });

  it('keeps the canonical identity within the bank table limit', () => {
    const longest = event({ referenceCode: 'R'.repeat(64), transferAmount: 999999999999 });
    const decision = decideTransfer(longest);
    expect(decision.kind).toBe('CANDIDATE');
    if (decision.kind === 'CANDIDATE') {
      expect(decision.canonicalTransactionId.length).toBeLessThanOrEqual(128);
      expect(decision.canonicalTransactionId).toMatch(/^[^\s\u0000-\u001f](?:[^\u0000-\u001f]*[^\s\u0000-\u001f])?$/);
    }
  });
});

