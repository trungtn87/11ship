import { BadRequestException } from '@nestjs/common';
import { LoginInput, parseLoginBody } from '../auth/auth-validation';
import { ADMIN_APP, ADMIN_PLATFORM } from './admin-auth-constants';
import { isTotpCodeShape } from './totp';

// Strict parsers of the administration bodies. A malformed shape is a plain 400 BAD_REQUEST that never echoes the value.

/**
 * Login body: the existing login parser (exact keys, the existing phone and password rules - no new password policy),
 * and then the fixed administration device labels. Those labels prove nothing; they only keep the contract exact.
 */
export function parseAdminLoginBody(body: unknown): LoginInput {
  const input = parseLoginBody(body);
  if (input.device.platform !== ADMIN_PLATFORM || input.device.app !== ADMIN_APP) {
    throw new BadRequestException();
  }
  return input;
}

/** Bodies that carry nothing (`{}`): enrollment start and logout. */
export function parseEmptyBody(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw new BadRequestException();
  }
}

/** `{ "code": "123456" }`: exactly six ASCII digits, never trimmed or repaired. */
export function parseTotpBody(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const keys = Object.keys(body);
  const { code } = body as { code?: unknown };
  if (keys.length !== 1 || keys[0] !== 'code' || !isTotpCodeShape(code)) {
    throw new BadRequestException();
  }
  return code;
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;.*)?$/i;

export function isJsonContentType(header: string | string[] | undefined): boolean {
  return typeof header === 'string' && JSON_CONTENT_TYPE.test(header);
}
