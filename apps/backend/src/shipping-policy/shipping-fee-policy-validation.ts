import { AppError } from '../common/app-errors';
import { MAX_DISTANCE_M, FeePolicy, validateFeePolicy } from './shipping-fee-policy';

// Strict parsers of the fee-policy routes (M06-A). Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID; a well-shaped
// table that breaks a business rule (gap, overlap, negative fee ...) is SHIPPING_POLICY_INVALID. The actor never comes from a body.

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) {
    if (!Object.hasOwn(source, key)) {
      invalid();
    }
  }
  for (const key of Object.keys(source)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalid();
    }
  }
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid());

function version(value: unknown): number {
  const n = whole(value);
  return n < 1 ? invalid() : n;
}

function parsePolicy(source: Record<string, unknown>): FeePolicy {
  if (!Array.isArray(source.tiers) || source.tiers.length > 50) {
    return invalid();
  }
  const tiers = source.tiers.map((raw: unknown) => {
    const tier = plainObject(raw);
    exactKeys(tier, ['from_m', 'to_m', 'fee_vnd']);
    return { fromM: whole(tier.from_m), toM: whole(tier.to_m), feeVnd: whole(tier.fee_vnd) };
  });
  return { tiers };
}

function parseValidPolicy(source: Record<string, unknown>): FeePolicy {
  const policy = parsePolicy(source);
  if (validateFeePolicy(policy).length > 0) {
    throw new AppError('SHIPPING_POLICY_INVALID');
  }
  return policy;
}

export interface SaveDraftBody {
  readonly expectedVersion: number;
  readonly policy: FeePolicy;
}

export function parseSaveDraftBody(body: unknown): SaveDraftBody {
  const source = plainObject(body);
  exactKeys(source, ['expected_version', 'tiers']);
  return { expectedVersion: version(source.expected_version), policy: parseValidPolicy(source) };
}

export interface ApplyBody {
  readonly expectedVersion: number;
  readonly note: string | null;
}

export const NOTE_MAX_CODEPOINTS = 200;

export function parseApplyBody(body: unknown): ApplyBody {
  const source = plainObject(body);
  exactKeys(source, ['expected_version'], ['note']);
  let note: string | null = null;
  if (source.note !== undefined && source.note !== null) {
    if (typeof source.note !== 'string') {
      return invalid();
    }
    const trimmed = source.note.normalize('NFC').trim();
    if ([...trimmed].length > NOTE_MAX_CODEPOINTS || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      return invalid();
    }
    note = trimmed === '' ? null : trimmed;
  }
  return { expectedVersion: version(source.expected_version), note };
}

export interface PreviewBody {
  readonly distanceM: number;
  /** Absent: price against the table in force. Present: price against the table being edited. */
  readonly policy: FeePolicy | null;
}

export function parsePreviewBody(body: unknown): PreviewBody {
  const source = plainObject(body);
  exactKeys(source, ['distance_m'], ['tiers']);
  const distance = source.distance_m;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || distance > MAX_DISTANCE_M) {
    return invalid();
  }
  const hasPolicy = source.tiers !== undefined;
  return { distanceM: distance, policy: hasPolicy ? parseValidPolicy(source) : null };
}
