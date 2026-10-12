import { BadRequestException } from '@nestjs/common';
import {
  DeviceInfo,
  exactObject,
  isWellFormed,
  parseDevice,
  parsePassword,
} from '../auth/auth-validation';
import { CONSENT_VERSION_PATTERN } from '../auth/auth-constants';
import { requireNormalizedPhone } from '../auth/phone';
import { ClientApp, ClientPlatform, CLIENT_APPS, CLIENT_PLATFORMS } from './client-auth-constants';

// Strict request-body parser of POST /v1/client-auth/register (task M01.03 section 4, contract10 section 3). Pure: no
// I/O, no Nest pipeline magic. The body is accepted only when it is a plain JSON object whose keys are EXACTLY the six
// allowed ones, at every level: an extra key (role, permissions, driver_type, accepted_at, anything) is refused, never
// ignored. Failures never echo the offending value or key: a malformed shape is a plain 400 BAD_REQUEST, a bad phone is
// INVALID_PHONE (the same classification as the legacy parser).

export const FULL_NAME_MIN_LENGTH = 1;
export const FULL_NAME_MAX_LENGTH = 120;

/** Same bound as the legacy register parser for the proof token text; its shape is checked by the service. */
const VERIFICATION_TOKEN_MAX_LENGTH = 256;

export interface ClientDevice extends DeviceInfo {
  readonly platform: ClientPlatform;
  readonly app: ClientApp;
}

export interface ClientConsentInput {
  readonly termsVersion: string;
  readonly privacyVersion: string;
}

export interface ClientRegisterInput {
  readonly phoneNormalized: string;
  /** The password exactly as sent: 8..128 code points, never trimmed or normalized. */
  readonly password: string;
  /** Raw proof token as sent; the service checks its shape (malformed -> VERIFICATION_PROOF_INVALID). */
  readonly verificationToken: string;
  readonly device: ClientDevice;
  /** NFC, collapsed and trimmed, 1..120 code points. */
  readonly fullName: string;
  readonly consent: ClientConsentInput;
}

function reject(): never {
  throw new BadRequestException();
}

// Unicode White_Space (not JavaScript's \s, which also matches U+FEFF, a zero-width format character that must be REFUSED
// below rather than collapsed away).
const WHITE_SPACE_RUN = /\p{White_Space}+/gu;
const LEADING_SPACE = /^ /;
const TRAILING_SPACE = / $/;
// General categories Cc (control) and Cf (format, which includes the zero-width characters).
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * The customer's full name, normalized (contract10 section 3). In this order:
 *   1. a string that is valid Unicode (a lone surrogate is refused, not altered);
 *   2. Unicode normalization form NFC;
 *   3. every run of Unicode white space becomes ONE U+0020 and the ends are trimmed of that space (tab, newline, NBSP and
 *      ideographic space are white space, so they become spaces and are not refused);
 *   4. any remaining control (Cc) or format (Cf, zero-width included) character refuses the name;
 *   5. 1..120 Unicode code points remain.
 * The name is not required to be Latin or to have two words: it is only a customer profile name.
 */
export function normalizeFullName(value: unknown): string {
  if (typeof value !== 'string' || !isWellFormed(value)) {
    return reject();
  }
  const normalized = value
    .normalize('NFC')
    .replace(WHITE_SPACE_RUN, ' ')
    .replace(LEADING_SPACE, '')
    .replace(TRAILING_SPACE, '');
  if (CONTROL_OR_FORMAT.test(normalized)) {
    return reject();
  }
  const length = [...normalized].length;
  if (length < FULL_NAME_MIN_LENGTH || length > FULL_NAME_MAX_LENGTH) {
    return reject();
  }
  return normalized;
}

function parseClientDevice(value: unknown): ClientDevice {
  const device = parseDevice(value);
  if (!(CLIENT_PLATFORMS as readonly string[]).includes(device.platform)) {
    return reject();
  }
  if (!(CLIENT_APPS as readonly string[]).includes(device.app)) {
    return reject();
  }
  return { deviceId: device.deviceId, platform: device.platform as ClientPlatform, app: device.app as ClientApp };
}

function parseConsent(value: unknown): ClientConsentInput {
  const consent = exactObject(value, ['terms_version', 'privacy_version']);
  const { terms_version: termsVersion, privacy_version: privacyVersion } = consent;
  if (
    typeof termsVersion !== 'string' ||
    !CONSENT_VERSION_PATTERN.test(termsVersion) ||
    typeof privacyVersion !== 'string' ||
    !CONSENT_VERSION_PATTERN.test(privacyVersion)
  ) {
    return reject();
  }
  return { termsVersion, privacyVersion };
}

export function parseClientRegisterBody(body: unknown): ClientRegisterInput {
  const parsed = exactObject(body, ['phone', 'password', 'verification_token', 'device', 'full_name', 'consent']);
  if (typeof parsed.verification_token !== 'string' || parsed.verification_token.length > VERIFICATION_TOKEN_MAX_LENGTH) {
    return reject();
  }
  return {
    phoneNormalized: requireNormalizedPhone(parsed.phone),
    password: parsePassword(parsed.password),
    verificationToken: parsed.verification_token,
    device: parseClientDevice(parsed.device),
    fullName: normalizeFullName(parsed.full_name),
    consent: parseConsent(parsed.consent),
  };
}
