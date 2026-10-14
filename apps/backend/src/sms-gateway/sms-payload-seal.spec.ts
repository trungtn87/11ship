import { describe, expect, it } from '@jest/globals';
import { CryptoError } from '../crypto/crypto-error';
import { fixtureKeyring } from '../crypto/test-keys.fixture';

const JOB = '0b8f4ac2-6b0e-4a4a-9a43-3c4c7f3a1d11';
const PLAIN = Buffer.from(JSON.stringify({ to: '+84912345678', text: '11Ship: Ma xac thuc dang ky cua ban la 123456. Hieu luc 5 phut. Khong chia se ma nay.' }));

describe('sealSmsPayload / openSmsPayload (issue #102)', () => {
  const version = fixtureKeyring('k1').active();

  it('round-trips, never stores the plaintext in the envelope, and uses a fresh IV every time', () => {
    const a = version.sealSmsPayload(JOB, PLAIN);
    const b = version.sealSmsPayload(JOB, PLAIN);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.ciphertext.toString('latin1')).not.toContain('123456');
    expect(a.ciphertext.toString('latin1')).not.toContain('+84912345678');
    expect(version.openSmsPayload(JOB, a).equals(PLAIN)).toBe(true);
  });

  it('is bound to the job: another job id, another key or any tampering fails closed', () => {
    const sealed = version.sealSmsPayload(JOB, PLAIN);
    expect(() => version.openSmsPayload('0b8f4ac2-6b0e-4a4a-9a43-3c4c7f3a1d12', sealed)).toThrow(CryptoError);
    const other = fixtureKeyring('k2');
    expect(() => other.version('k2')?.openSmsPayload(JOB, sealed)).toThrow(CryptoError);
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] as number) ^ 1;
    expect(() => version.openSmsPayload(JOB, { ...sealed, ciphertext: flipped })).toThrow(CryptoError);
    const badTag = Buffer.from(sealed.tag);
    badTag[0] = (badTag[0] as number) ^ 1;
    expect(() => version.openSmsPayload(JOB, { ...sealed, tag: badTag })).toThrow(CryptoError);
    expect(() => version.openSmsPayload(JOB, { ...sealed, iv: Buffer.alloc(5) })).toThrow(CryptoError);
  });

  it('refuses empty or oversized input', () => {
    expect(() => version.sealSmsPayload(JOB, Buffer.alloc(0))).toThrow(CryptoError);
    expect(() => version.sealSmsPayload(JOB, Buffer.alloc(513))).toThrow(CryptoError);
    expect(() => version.sealSmsPayload('', PLAIN)).toThrow(CryptoError);
  });
});
