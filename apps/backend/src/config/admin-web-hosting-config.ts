// Same-origin hosting of the administration web (issue #49, from PR #42). Pure parsing: no environment access and no
// I/O, exactly like the other config files, so it is testable and nothing that loads AppConfig depends on HTTP code.
//
//   ADMIN_WEB_STAGING_ENABLED   exactly "true" or "false"; unset means false. "true" is valid ONLY for APP_ENV=staging
//                               and only when the administration web authentication is enabled (ADMIN_AUTH_ENABLED=true
//                               with its variables valid): the page is useless without it, and a page served without
//                               the module behind it would only be a public file server.
//
// Fail closed: any other value, any other environment and a missing administration module stop startup. Only the
// variable NAME is ever reported, never a value.

export const ADMIN_WEB_STAGING_ENABLED_VARIABLE = 'ADMIN_WEB_STAGING_ENABLED';

export interface AdminWebHostingConfig {
  readonly enabled: true;
}

export type AdminWebHostingParse =
  | { readonly ok: true; readonly config: AdminWebHostingConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

export function parseAdminWebHosting(input: {
  readonly appEnv: string | undefined;
  readonly enabledRaw: string | undefined;
  readonly adminAuthEnabled: boolean;
}): AdminWebHostingParse {
  const { appEnv, enabledRaw, adminAuthEnabled } = input;
  if (enabledRaw === undefined || enabledRaw === 'false') {
    return { ok: true, config: undefined };
  }
  if (enabledRaw !== 'true') {
    return { ok: false, invalid: [ADMIN_WEB_STAGING_ENABLED_VARIABLE] };
  }
  // production, development and test (and an unusable APP_ENV) can never serve the page, and neither can a process
  // without the administration module behind it.
  if (appEnv !== 'staging' || !adminAuthEnabled) {
    return { ok: false, invalid: [ADMIN_WEB_STAGING_ENABLED_VARIABLE] };
  }
  return { ok: true, config: { enabled: true } };
}
