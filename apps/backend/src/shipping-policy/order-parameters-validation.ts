import { parseReason } from '../admin-access/admin-access-validation';
import { AppError } from '../common/app-errors';
import { FEE_ANSWER_MINUTES_MAX, FEE_ANSWER_MINUTES_MIN } from './fee-answer-parameter';

export interface OrderParametersBody {
  readonly expectedVersion: number;
  readonly feeAnswerMinutes: number;
  /** Why the setting changes, written to the audit row. */
  readonly reason: string | null;
}

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

/**
 * "Thời gian trả lời đề xuất phí", in whole minutes: a positive integer within the documented range. A decimal, a string, zero, a negative number, a value outside
 * the range, a missing field or an extra key is refused with ADMIN_INPUT_INVALID before anything is read or written.
 */
export function parseOrderParametersBody(body: unknown): OrderParametersBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return invalid();
  }
  const source = body as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!['expected_version', 'fee_answer_minutes', 'reason'].includes(key)) {
      return invalid();
    }
  }
  const version = source.expected_version;
  const minutes = source.fee_answer_minutes;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return invalid();
  }
  if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < FEE_ANSWER_MINUTES_MIN || minutes > FEE_ANSWER_MINUTES_MAX) {
    return invalid();
  }
  return { expectedVersion: version, feeAnswerMinutes: minutes, reason: Object.hasOwn(source, 'reason') ? parseReason(source.reason) : null };
}
