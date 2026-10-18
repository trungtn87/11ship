import { AppError } from '../common/app-errors';
import { EligibilityValues } from './eligibility-parameters-repository';

// Strict parser of the eligibility-parameter write (M06-B/C). The bounds are the database's own CHECKs; the radius is not a parameter.

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

export const ELIGIBILITY_BOUNDS = {
  external_max_deliveries: [1, 20],
  batch_max_delay_seconds: [0, 3600],
  pickup_service_seconds: [0, 1800],
  handoff_service_seconds: [0, 1800],
} as const;

export interface SaveEligibilityBody {
  readonly expectedVersion: number;
  readonly values: EligibilityValues;
}

export function parseSaveEligibilityBody(body: unknown): SaveEligibilityBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return invalid();
  }
  const source = body as Record<string, unknown>;
  const allowed = ['expected_version', ...Object.keys(ELIGIBILITY_BOUNDS)];
  for (const key of allowed) {
    if (!Object.hasOwn(source, key)) {
      return invalid();
    }
  }
  if (Object.keys(source).some((key) => !allowed.includes(key))) {
    return invalid();
  }
  const bounded = (key: keyof typeof ELIGIBILITY_BOUNDS): number => {
    const value = source[key];
    const [min, max] = ELIGIBILITY_BOUNDS[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
  };
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return invalid();
  }
  return {
    expectedVersion: version,
    values: {
      externalMaxDeliveries: bounded('external_max_deliveries'),
      batchMaxDelaySeconds: bounded('batch_max_delay_seconds'),
      pickupServiceSeconds: bounded('pickup_service_seconds'),
      handoffServiceSeconds: bounded('handoff_service_seconds'),
    },
  };
}
