import { Readable } from 'node:stream';
import { parsePassword } from '../../auth/auth-validation';
import { requireNormalizedPhone } from '../../auth/phone';

const MAX_INPUT_BYTES = 4096;

export class CliInputError extends Error {
  constructor() {
    super('INVALID_INPUT');
    this.name = 'CliInputError';
  }
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) {
      throw new CliInputError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The bootstrap credentials: ONE JSON object `{"phone": "...", "password": "..."}` on standard input - never an
 * argument, never an environment variable. Exactly these two keys; the phone follows the existing phone rule, and the
 * password the existing password-creation rule (no new policy). The failure never says which part was wrong or echoes it.
 */
export async function readBootstrapInput(stream: Readable): Promise<{ phoneNormalized: string; password: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readAll(stream));
  } catch {
    throw new CliInputError();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliInputError();
  }
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== 'password' || keys[1] !== 'phone') {
    throw new CliInputError();
  }
  const { phone, password } = parsed as { phone: unknown; password: unknown };
  try {
    return { phoneNormalized: requireNormalizedPhone(phone), password: parsePassword(password) };
  } catch {
    throw new CliInputError();
  }
}

export const SYSTEM_RECOVERY_CONFIRMATION = 'RESET_SYSTEM_LOCAL_TEST';

async function readExactObject(stream: Readable, keys: readonly string[]): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readAll(stream));
  } catch {
    throw new CliInputError();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliInputError();
  }
  const actual = Object.keys(parsed).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new CliInputError();
  }
  return parsed as Record<string, unknown>;
}

/** `--check` input: exactly {"phone"}. */
export async function readSystemRecoveryCheckInput(stream: Readable): Promise<{ phoneNormalized: string }> {
  const { phone } = await readExactObject(stream, ['phone']);
  try {
    return { phoneNormalized: requireNormalizedPhone(phone) };
  } catch {
    throw new CliInputError();
  }
}

/** `--apply` input: exactly {"phone","password","expected_version","confirmation"}. */
export async function readSystemRecoveryApplyInput(
  stream: Readable,
): Promise<{ phoneNormalized: string; password: string; expectedVersion: number }> {
  const { phone, password, expected_version: version, confirmation } = await readExactObject(stream, [
    'phone',
    'password',
    'expected_version',
    'confirmation',
  ]);
  if (confirmation !== SYSTEM_RECOVERY_CONFIRMATION || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new CliInputError();
  }
  try {
    return { phoneNormalized: requireNormalizedPhone(phone), password: parsePassword(password), expectedVersion: version };
  } catch {
    throw new CliInputError();
  }
}
