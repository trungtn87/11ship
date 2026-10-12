import { isLoopbackHost } from '../test-sms/test-sms-config';

// Configuration of the client registration (M01.03). Pure validation: nothing here reads the environment by itself and only
// the NAMES of invalid variables are ever reported, never their values.
//
// The consent pair is the one (terms_version, privacy_version) the server accepts for a registration. It is configuration,
// not code: nothing in the application hard-codes a pair or bypasses the comparison. The pair the Owner approved for local
// development and test is documented in docs/tasks/M01-03-customer-register-local-handoff.md section 3 and in .env.example;
// it is NOT valid for staging or production (no production consent content is approved), so the variables are refused there
// exactly like the other local-only switches (TEST_INBOX): setting them outside development/test stops startup.
//
//   CLIENT_AUTH_TERMS_VERSION    one consent version token, grammar [A-Za-z0-9._-] 1..64 (the user_consents CHECK)
//   CLIENT_AUTH_PRIVACY_VERSION  the same grammar
//
// Both unset: the registration endpoint stays closed (a first execution answers SERVICE_UNAVAILABLE before any row is
// written). Exactly one set, or a bad token: startup is refused, naming only the variable(s).

export const CLIENT_AUTH_TERMS_VERSION_ENV = 'CLIENT_AUTH_TERMS_VERSION';
export const CLIENT_AUTH_PRIVACY_VERSION_ENV = 'CLIENT_AUTH_PRIVACY_VERSION';

/** Same grammar as the schema CHECKs user_consents_terms_version_ck / user_consents_privacy_version_ck. */
const CONSENT_VERSION_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

export interface ClientAuthConfig {
  readonly termsVersion: string;
  readonly privacyVersion: string;
}

export type ClientAuthConfigResult =
  | { readonly ok: true; readonly config: ClientAuthConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

export interface ClientAuthConfigInput {
  /** Undefined when APP_ENV itself is invalid (that variable is reported on its own). */
  readonly appEnv: string | undefined;
  readonly termsRaw: string | undefined;
  readonly privacyRaw: string | undefined;
}

export function parseClientAuth(input: ClientAuthConfigInput): ClientAuthConfigResult {
  const termsSet = input.termsRaw !== undefined;
  const privacySet = input.privacyRaw !== undefined;
  if (!termsSet && !privacySet) {
    return { ok: true, config: undefined };
  }

  // The test pair exists for local development and test only. An invalid APP_ENV is already reported by its own name.
  if (input.appEnv !== undefined && input.appEnv !== 'development' && input.appEnv !== 'test') {
    const invalid: string[] = [];
    if (termsSet) {
      invalid.push(CLIENT_AUTH_TERMS_VERSION_ENV);
    }
    if (privacySet) {
      invalid.push(CLIENT_AUTH_PRIVACY_VERSION_ENV);
    }
    return { ok: false, invalid };
  }

  const invalid: string[] = [];
  if (!termsSet || !CONSENT_VERSION_TOKEN.test(input.termsRaw ?? '')) {
    invalid.push(CLIENT_AUTH_TERMS_VERSION_ENV);
  }
  if (!privacySet || !CONSENT_VERSION_TOKEN.test(input.privacyRaw ?? '')) {
    invalid.push(CLIENT_AUTH_PRIVACY_VERSION_ENV);
  }
  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { termsVersion: input.termsRaw ?? '', privacyVersion: input.privacyRaw ?? '' } };
}

/**
 * LOCAL_WEB mode of the client authentication (contract11 section 6): the WEB platform is accepted only when APP_ENV is
 * explicitly development or test AND the server is bound to a loopback address. It is decided once from the validated
 * startup configuration. Nothing about a request (X-Forwarded-For, the app label, a header) takes part in it, so a remote
 * client cannot turn it on, and production and staging never have it.
 */
export function isLocalWebMode(appEnv: string, host: string): boolean {
  return (appEnv === 'development' || appEnv === 'test') && isLoopbackHost(host);
}
