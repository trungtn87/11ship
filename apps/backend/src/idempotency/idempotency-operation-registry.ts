export interface IdempotencyTtlPolicy {
  readonly replayTtlSeconds: number;
  readonly dedupeTtlSeconds: number;
}

export interface IdempotencyOperationTtlEntry extends IdempotencyTtlPolicy {
  readonly operationId: string;
}

const MAX_TTL_SECONDS = 604800;
const MAX_OPERATION_ID = 128;

function validPolicy(policy: IdempotencyTtlPolicy): boolean {
  return (
    Number.isSafeInteger(policy.replayTtlSeconds) &&
    Number.isSafeInteger(policy.dedupeTtlSeconds) &&
    policy.replayTtlSeconds >= 1 &&
    policy.replayTtlSeconds <= policy.dedupeTtlSeconds &&
    policy.dedupeTtlSeconds <= MAX_TTL_SECONDS
  );
}

/**
 * Immutable server-owned TTL overrides. Request payloads/headers never select TTLs.
 * Business modules may register a fixed operation policy when they are implemented.
 */
export class IdempotencyOperationRegistry {
  readonly #policies: ReadonlyMap<string, IdempotencyTtlPolicy>;

  constructor(entries: readonly IdempotencyOperationTtlEntry[] = []) {
    const policies = new Map<string, IdempotencyTtlPolicy>();
    for (const entry of entries) {
      if (
        typeof entry.operationId !== 'string' ||
        entry.operationId.length < 1 ||
        entry.operationId.length > MAX_OPERATION_ID ||
        !validPolicy(entry)
      ) {
        throw new RangeError('invalid idempotency operation TTL policy');
      }
      if (policies.has(entry.operationId)) {
        throw new RangeError('duplicate idempotency operation TTL policy');
      }
      policies.set(
        entry.operationId,
        Object.freeze({
          replayTtlSeconds: entry.replayTtlSeconds,
          dedupeTtlSeconds: entry.dedupeTtlSeconds,
        }),
      );
    }
    this.#policies = policies;
  }

  resolve(operationId: string, fallback: IdempotencyTtlPolicy): IdempotencyTtlPolicy {
    if (!validPolicy(fallback)) {
      throw new RangeError('invalid idempotency fallback TTL policy');
    }
    return this.#policies.get(operationId) ?? fallback;
  }
}
