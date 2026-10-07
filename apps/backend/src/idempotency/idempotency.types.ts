import { JsonValue } from '../shared/json/safe-json';
import { TransactionContext } from '../transaction/transaction-context';

export interface IdempotencyIdentity {
  readonly scopeType: string;
  readonly scopeId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
}

export interface IdempotencyWorkResult {
  readonly responseStatus: number;
  readonly responseBody: unknown;
  /** Non-secret identifiers only; validated by the replay-guard JSON policy. */
  readonly replayGuard: unknown;
}

export type ReplayAuthorization = (
  context: TransactionContext,
  replayGuard: JsonValue,
) => Promise<void>;

export interface IdempotencyExecuteRequest extends IdempotencyIdentity {
  readonly logicalRequest: unknown;
  /**
   * Sensitive operations MUST set this and provide replayAuthorization. The operation adapter owns
   * that choice; it is server code, never a client-controlled flag.
   */
  readonly sensitiveReplay?: boolean;
  readonly replayAuthorization?: ReplayAuthorization;
}

export interface IdempotencyOutcome {
  readonly responseStatus: number;
  readonly responseBody: JsonValue;
  readonly replayed: boolean;
}

export interface IdempotencyOptions {
  readonly advisoryWaitMs: number;
  readonly businessLockTimeoutMs: number;
  readonly replayTtlSeconds: number;
  readonly dedupeTtlSeconds: number;
}
