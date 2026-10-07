import { describe, expect, it } from '@jest/globals';
import { deriveSubkeys, HKDF_SALT } from './kdf';
import { FIXTURE_MASTER_K1 } from './test-keys.fixture';

describe('HKDF-SHA-256 subkey derivation — known answers (C25)', () => {
  it('matches independently computed vectors for the fixture master key', () => {
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(subkeys.requestHmac.toString('hex')).toBe(
      '691ebe6c1637bb0f16920fdacb2ea52a65ae17227bbfa66075dfa7325a625a14',
    );
    expect(subkeys.replayEncryption.toString('hex')).toBe(
      'afc55c816facfa0ed8d7d33548fb7894841341e9090b7eff13ed08f7f3916b00',
    );
  });

  it('uses the documented salt and gives two different 32-byte subkeys', () => {
    expect(HKDF_SALT.toString('utf8')).toBe('11ship.transactional-core.v1');
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(subkeys.requestHmac).toHaveLength(32);
    expect(subkeys.replayEncryption).toHaveLength(32);
    expect(subkeys.requestHmac.equals(subkeys.replayEncryption)).toBe(false);
  });
});
