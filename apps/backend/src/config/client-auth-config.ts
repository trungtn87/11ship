import { isLoopbackHost } from '../test-sms/test-sms-config';

// Configuration of the client registration (M01.03). Pure validation: nothing here reads the environment by itself and only
// the NAMES of invalid variables are ever reported, never their values.
//
// The consent pair is the one (terms_version, privacy_version) the server accepts for a registration. It is configuration,
// not code: nothing in the application hard-codes a pair or bypasses the comparison. The pair the Owner approved for local
// development and test is documented in docs/tasks/M01-03-customer-register-local-handoff.md section 3 and in .env.example;
// it is NOT valid for staging. Owner decision 2026-10-14: the VPS is the real operating build (APP_ENV=production), so a
// production process accepts the pair the Owner approved for it (docs/current/M01-production-profile-20261014.md); the
// variables are still refused in staging and any unknown environment, exactly like the other local-only switches.
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

  // Development, test and production only. An invalid APP_ENV is already reported by its own name.
  if (input.appEnv !== undefined && input.appEnv !== 'development' && input.appEnv !== 'test' && input.appEnv !== 'production') {
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

/**
 * The real operating build (Owner decision 2026-10-14): APP_ENV=production AND a loopback bind (the service is reached only
 * through the reverse proxy on the same machine). Decided once from the validated startup configuration, like LOCAL_WEB;
 * nothing about a request takes part. It opens ONLY the gates that name it explicitly (native Android binding, Admin web
 * hosting, USER lock); it never turns on LOCAL_WEB, DISABLED_TEST or any test/fixture mode.
 */
export function isProductionOnLoopback(appEnv: string, host: string): boolean {
  return appEnv === 'production' && isLoopbackHost(host);
}

// Phone verification mode of the client registration (M01 Food register, no-OTP test build).
//
//   CLIENT_AUTH_PHONE_VERIFICATION_MODE  REQUIRED (default when unset) | DISABLED_TEST
//
// REQUIRED is the contract of M01.03: a registration needs a valid REGISTER proof. DISABLED_TEST registers an account
// WITHOUT any proof and records it as TEST_UNVERIFIED (phone_verified_at NULL); it exists for local development and test
// only: APP_ENV must be development or test AND the server must be bound to a loopback address (a test VPS reaches it
// through a reverse proxy on the loopback interface). Any other value, and DISABLED_TEST anywhere else, stops startup
// naming only the variable. Nothing about a request (header, app label, body field) can switch the mode.

export const CLIENT_AUTH_PHONE_VERIFICATION_MODE_ENV = 'CLIENT_AUTH_PHONE_VERIFICATION_MODE';

export const CLIENT_PHONE_VERIFICATION_MODES = ['REQUIRED', 'DISABLED_TEST'] as const;
export type ClientPhoneVerificationMode = (typeof CLIENT_PHONE_VERIFICATION_MODES)[number];

export type ClientPhoneVerificationModeResult =
  | { readonly ok: true; readonly mode: ClientPhoneVerificationMode }
  | { readonly ok: false; readonly invalid: readonly string[] };

export interface ClientPhoneVerificationModeInput {
  /** Undefined when APP_ENV itself is invalid (that variable is reported on its own). */
  readonly appEnv: string | undefined;
  readonly host: string;
  readonly modeRaw: string | undefined;
}

export function parseClientPhoneVerificationMode(
  input: ClientPhoneVerificationModeInput,
): ClientPhoneVerificationModeResult {
  if (input.modeRaw === undefined || input.modeRaw === 'REQUIRED') {
    return { ok: true, mode: 'REQUIRED' };
  }
  if (input.modeRaw !== 'DISABLED_TEST') {
    return { ok: false, invalid: [CLIENT_AUTH_PHONE_VERIFICATION_MODE_ENV] };
  }
  // An invalid APP_ENV is reported by its own name; the mode is only judged against a known environment.
  if (input.appEnv === undefined) {
    return { ok: true, mode: 'REQUIRED' };
  }
  if (!isDisabledTestAllowed(input.appEnv, input.host)) {
    return { ok: false, invalid: [CLIENT_AUTH_PHONE_VERIFICATION_MODE_ENV] };
  }
  return { ok: true, mode: 'DISABLED_TEST' };
}

/** The one rule: explicit development/test AND a loopback bind. Same shape as LOCAL_WEB, decided from startup config only. */
export function isDisabledTestAllowed(appEnv: string, host: string): boolean {
  return isLocalWebMode(appEnv, host);
}
