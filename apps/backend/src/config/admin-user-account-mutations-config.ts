import { isLoopbackHost } from '../test-sms/test-sms-config';

// Gate of the administration USER account mutations (lock / unlock; handoff M01-admin-account-lock, decision D15).
//
//   ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED   exactly "true" or "false"; unset means false. "true" is valid ONLY for APP_ENV
//                                          development or test, a loopback HOST and the administration web authentication
//                                          enabled. The impact of a lock on running business (orders, money, deliveries) is
//                                          not implemented in M01, so no other environment may open the mutation.
//
// Fail closed: any other value, any other environment, a non-loopback bind and a missing administration module stop
// startup. Only the variable NAME is ever reported, never a value.

export const ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED_VARIABLE = 'ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED';

export interface AdminUserAccountMutationsConfig {
  readonly enabled: true;
}

export type AdminUserAccountMutationsParse =
  | { readonly ok: true; readonly config: AdminUserAccountMutationsConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

export function parseAdminUserAccountMutations(input: {
  readonly appEnv: string | undefined;
  readonly host: string;
  readonly enabledRaw: string | undefined;
  readonly adminAuthEnabled: boolean;
}): AdminUserAccountMutationsParse {
  const { appEnv, host, enabledRaw, adminAuthEnabled } = input;
  if (enabledRaw === undefined || enabledRaw === 'false') {
    return { ok: true, config: undefined };
  }
  if (enabledRaw !== 'true') {
    return { ok: false, invalid: [ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED_VARIABLE] };
  }
  const local = (appEnv === 'development' || appEnv === 'test') && isLoopbackHost(host);
  if (!local || !adminAuthEnabled) {
    return { ok: false, invalid: [ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED_VARIABLE] };
  }
  return { ok: true, config: { enabled: true } };
}
