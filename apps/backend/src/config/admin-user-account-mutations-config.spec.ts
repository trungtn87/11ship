import { describe, expect, it } from '@jest/globals';
import { ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED_VARIABLE, parseAdminUserAccountMutations } from './admin-user-account-mutations-config';

const REFUSED = { ok: false, invalid: [ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED_VARIABLE] };

describe('parseAdminUserAccountMutations (ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED)', () => {
  it('is closed when unset or exactly "false", whatever the environment', () => {
    for (const appEnv of ['production', 'staging', 'development', 'test', undefined]) {
      for (const enabledRaw of [undefined, 'false']) {
        expect(parseAdminUserAccountMutations({ appEnv, host: '0.0.0.0', enabledRaw, adminAuthEnabled: false })).toEqual({ ok: true, config: undefined });
      }
    }
  });

  it('opens only for development/test on a loopback bind with the administration module', () => {
    for (const appEnv of ['development', 'test']) {
      for (const host of ['127.0.0.1', 'localhost', '::1']) {
        expect(parseAdminUserAccountMutations({ appEnv, host, enabledRaw: 'true', adminAuthEnabled: true })).toEqual({ ok: true, config: { enabled: true } });
      }
    }
  });

  it.each([
    ['production', '127.0.0.1', true],
    ['staging', '127.0.0.1', true],
    [undefined, '127.0.0.1', true],
    ['test', '0.0.0.0', true],
    ['development', '10.0.0.5', true],
    ['test', '127.0.0.1', false],
  ])('refuses "true" for APP_ENV=%s HOST=%s adminAuth=%s, naming only the variable', (appEnv, host, adminAuthEnabled) => {
    expect(parseAdminUserAccountMutations({ appEnv, host, enabledRaw: 'true', adminAuthEnabled })).toEqual(REFUSED);
  });

  it.each(['TRUE', 'True', '1', 'yes', '', ' true', 'true '])('refuses the odd value %j everywhere', (enabledRaw) => {
    expect(parseAdminUserAccountMutations({ appEnv: 'test', host: '127.0.0.1', enabledRaw, adminAuthEnabled: true })).toEqual(REFUSED);
  });
});
