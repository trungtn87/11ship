import { AppError, TechnicalError } from '../common/app-errors';
import { AppConfig } from '../config/app-config';
import { ClientAuthConfig, ClientPhoneVerificationMode, isLocalWebMode } from '../config/client-auth-config';
import { ClientPlatform } from './client-auth-constants';
import { ClientConsentInput, ClientDevice } from './client-auth-validation';
import { TERMS_PAGE_VERSION } from '../legal/terms-page';
import { PRIVACY_PAGE_VERSION } from '../legal/privacy-page';

// Server-side policy of the client registration (M01.03), decided from the validated startup configuration and never from
// anything a request says about itself (no X-Forwarded-For, no app label, no header).

/** Injection token of the settings below. */
export const CLIENT_AUTH_SETTINGS = Symbol('CLIENT_AUTH_SETTINGS');

export interface ClientAuthSettings {
  /** The one consent pair the server accepts, or undefined when none is configured (the endpoint is then closed). */
  readonly consent: ClientAuthConfig | undefined;
  /** LOCAL_WEB: explicit development/test AND a loopback bind (contract11 section 6). */
  readonly localWeb: boolean;
  /**
   * REQUIRED (a registration needs a proof) or DISABLED_TEST (no proof, TEST_UNVERIFIED account). Decided once from the
   * validated startup configuration; DISABLED_TEST exists only in development/test on a loopback bind. It is what
   * GET /v1/client-auth/config reports and what selects the registration body of POST /v1/client-auth/register.
   */
  readonly phoneVerificationMode: ClientPhoneVerificationMode;
  /** Legacy APK/device-proof compatibility only. Password sessions never require this verifier. */
  readonly androidEnabled?: boolean;
}

export function clientAuthSettingsFrom(config: AppConfig, deviceTrust?: unknown): ClientAuthSettings {
  return {
    consent: config.clientAuth,
    localWeb: isLocalWebMode(config.appEnv, config.host),
    phoneVerificationMode: config.clientPhoneVerificationMode ?? 'REQUIRED',
    androidEnabled: deviceTrust !== undefined,
  };
}

/** Android uses credentials/OTP and Bearer sessions. device_id is metadata, never authentication.
 * WEB retains its existing local-development restriction. Legacy proof is verified separately when presented. */
export function assertDeviceAllowed(settings: ClientAuthSettings, device: ClientDevice): void {
  assertPlatformAllowed(settings, device.platform);
}

/** Platform routing is separate from token validation and live account/role authorization. */
export function assertPlatformAllowed(settings: ClientAuthSettings, platform: ClientPlatform): void {
  if (platform === 'ANDROID') {
    return;
  }
  if (platform === 'WEB' && settings.localWeb) {
    return;
  }
  throw new AppError('DEVICE_PROOF_REQUIRED');
}

/** Previous APKs may still register while their owner updates to the approved pair. */
const LEGACY_TERMS_VERSION = 'terms-20261014-v1';
const LEGACY_PRIVACY_VERSION = 'privacy-20261017-v1';

function equalsPair(a: ClientAuthConfig, b: ClientAuthConfig): boolean {
  return a.termsVersion === b.termsVersion && a.privacyVersion === b.privacyVersion;
}

const LEGACY_PAIR: ClientAuthConfig = { termsVersion: LEGACY_TERMS_VERSION, privacyVersion: LEGACY_PRIVACY_VERSION };
const OFFICIAL_PAIR: ClientAuthConfig = { termsVersion: TERMS_PAGE_VERSION, privacyVersion: PRIVACY_PAGE_VERSION };

/**
 * The consent comparison of a FIRST execution (it runs inside the idempotency callback, before any row is written; a
 * committed replay never comes here, so a later change of the server pair cannot make an accepted registration fail or be
 * rewritten). No configured pair, or a configured pair that is not published, is a closed endpoint (unavailable), not an
 * accepted anything. A request pair that is not one of the published pairs is CONSENT_VERSION_UNSUPPORTED; while the two
 * Owner-approved versions coexist (backend before APK), both published pairs are accepted. The accepted pair is returned unchanged so user_consents stores what the user actually saw.
 * The accepted pairs are exactly the two published pairs (LEGACY_PAIR, OFFICIAL_PAIR), each half from the same release; a
 * configured value outside that allowlist closes the endpoint (TechnicalError), it never widens the accepted set.
 */
export function assertConsentSupported(settings: ClientAuthSettings, consent: ClientConsentInput): ClientAuthConfig {
  const configured = settings.consent;
  if (configured === undefined) {
    throw new TechnicalError('unavailable', 'No consent pair is configured for the client registration');
  }
  // The allowlist is checked on BOTH sides before any return. An environment value that is not one of the two published
  // pairs (arbitrary, or mixed terms/privacy from different releases) closes the endpoint, even when a request repeats it.
  if (!isPublishedPair(configured)) {
    throw new TechnicalError('unavailable', 'The configured consent pair is not a published pair; the client registration is closed');
  }
  if (!isPublishedPair(consent)) {
    throw new AppError('CONSENT_VERSION_UNSUPPORTED');
  }
  // Exactly one of the two published pairs is accepted: the configured one, or (during the migration window) the other one.
  // equalsPair compares both halves, so a mixed pair never matches either published pair.
  return { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion };
}

function isPublishedPair(pair: ClientAuthConfig): boolean {
  return equalsPair(pair, LEGACY_PAIR) || equalsPair(pair, OFFICIAL_PAIR);
}
