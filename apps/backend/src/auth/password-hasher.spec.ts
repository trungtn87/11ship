import { describe, expect, it } from '@jest/globals';
import { ARGON2_MEMORY_COST_KIB, ARGON2_PARALLELISM, ARGON2_TIME_COST, Argon2idPasswordHasher } from './password-hasher';

// Uses the real argon2 package (ADR-002). A hash costs about 19 MiB and two passes, so a handful per spec file
// is fine.
describe('Argon2idPasswordHasher (ADR-002)', () => {
  const hasher = new Argon2idPasswordHasher();

  it('uses the locked parameters as constants', () => {
    expect([ARGON2_MEMORY_COST_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM]).toEqual([19_456, 2, 1]);
  });

  it('produces an Argon2id PHC string with m=19456,t=2,p=1 and a fresh salt each time', async () => {
    const [a, b] = await Promise.all([hasher.hash('same password'), hasher.hash('same password')]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('same password');
    expect(a.length).toBeLessThanOrEqual(512); // the users_password_hash_ck bound
  });

  it('verifies the exact password and nothing else: no trimming, no case folding, no Unicode normalization', async () => {
    const decomposed = 'café password'; // e + combining acute
    const composed = 'café password'; // precomposed é
    const hash = await hasher.hash(decomposed);
    expect(await hasher.verify(hash, decomposed)).toBe(true);
    expect(await hasher.verify(hash, composed)).toBe(false);
    expect(await hasher.verify(hash, ` ${decomposed}`)).toBe(false);
    expect(await hasher.verify(hash, decomposed.toUpperCase())).toBe(false);
    expect(await hasher.verify(hash, '')).toBe(false);

    const padded = await hasher.hash('  padded  ');
    expect(await hasher.verify(padded, '  padded  ')).toBe(true);
    expect(await hasher.verify(padded, 'padded')).toBe(false);
  });

  it('spends a full verification against a throwaway hash for a missing account and never throws', async () => {
    await expect(hasher.verifyAgainstDummy('whatever')).resolves.toBeUndefined();
    await expect(hasher.verifyAgainstDummy('')).resolves.toBeUndefined();
  });
});
