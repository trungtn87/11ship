import { describe, expect, it } from '@jest/globals';
import { deriveSubkeys, HKDF_INFO_ADMIN_ACTIVATION_OTP_HMAC, HKDF_INFO_ADMIN_OPERATION_HMAC, HKDF_SALT } from './kdf';
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

  it('derives separate administration purpose subkeys with known answers, distinct from the replay subkeys', () => {
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(subkeys.adminPasswordBinding.toString('hex')).toBe(
      '4ee391f09b03da811d6e9da33def66ed1dd39b5a5a91cc32f9d4a3aa51b7f4e7',
    );
    expect(subkeys.adminCsrf.toString('hex')).toBe(
      '39b8aa83597d86ccb67fc89a32e19fe2a6ba4e7eae59db527cb0ef3590e9b5cb',
    );
    expect(subkeys.adminTotpEncryption.toString('hex')).toBe(
      'f4d5dc4a1e6f9d12cdecd6458b85f917952a967389d612297d4053e92d54f152',
    );
    const all = [
      subkeys.requestHmac,
      subkeys.replayEncryption,
      subkeys.adminPasswordBinding,
      subkeys.adminCsrf,
      subkeys.adminTotpEncryption,
      subkeys.adminOperation,
    ].map((key) => key.toString('hex'));
    expect(new Set(all).size).toBe(6);
  });

  it('M01-D-ADMIN-1B adds the operation subkey without changing any earlier derivation', () => {
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(HKDF_INFO_ADMIN_OPERATION_HMAC.toString('utf8')).toBe('admin-operation-hmac.v1');
    expect(subkeys.adminOperation.toString('hex')).toBe(
      '0eeb10368925f909014ff4f40a2c702adb662e3f5b44ec4c96cc08400021fb19',
    );
    // The earlier vectors above are asserted unchanged in the same file; repeated here for the reviewer.
    expect(subkeys.requestHmac.toString('hex')).toBe('691ebe6c1637bb0f16920fdacb2ea52a65ae17227bbfa66075dfa7325a625a14');
    expect(subkeys.adminTotpEncryption.toString('hex')).toBe(
      'f4d5dc4a1e6f9d12cdecd6458b85f917952a967389d612297d4053e92d54f152',
    );
  });

  it('M01-D-ADMIN-1C adds the activation OTP subkey without changing any earlier derivation', () => {
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(HKDF_INFO_ADMIN_ACTIVATION_OTP_HMAC.toString('utf8')).toBe('admin-activation-otp-hmac.v1');
    expect(subkeys.adminActivationOtp.toString('hex')).toBe(
      '2ea507cb507b424c99ecaffd89e1b07b2fad2e53df53d41a0f62786e3cb47ee5',
    );
    expect(subkeys.adminOperation.toString('hex')).toBe('0eeb10368925f909014ff4f40a2c702adb662e3f5b44ec4c96cc08400021fb19');
    const all = Object.values(subkeys).map((key) => key.toString('hex'));
    expect(new Set(all).size).toBe(8);
  });

  it('issue #102 adds the SMS payload subkey as a distinct purpose without changing any earlier derivation', () => {
    const subkeys = deriveSubkeys(FIXTURE_MASTER_K1);
    expect(subkeys.smsPayload.toString('hex')).toBe('cb1fa266815984e04c7c40379aa75285c75a57908dce19911bd1e94b55d2fe09');
    expect(subkeys.adminActivationOtp.toString('hex')).toBe('2ea507cb507b424c99ecaffd89e1b07b2fad2e53df53d41a0f62786e3cb47ee5');
    for (const [name, key] of Object.entries(subkeys)) {
      if (name !== 'smsPayload') {
        expect(key.equals(subkeys.smsPayload)).toBe(false);
      }
    }
  });
});
