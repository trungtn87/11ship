// Size/shape policies for JSON that is persisted or fingerprinted (ADR-003 §9 and §13.4).
// Two families exist and they are deliberately separate:
//  - "safe-metadata": audit metadata, replay_guard, outbox payload. Never allowed to carry secrets,
//    so known secret-like key names are rejected (a last-line filter, NOT PII governance).
//  - "replay-payload" / "logical-request": legitimately contain secrets (an access token to replay, a
//    password that must be part of the HMAC fingerprint). Key names are NOT scanned; they are
//    protected by encryption / HMAC and must never be logged.

export const MAX_JSON_DEPTH = 8;
export const MAX_JSON_NODES = 65_536;

export type JsonPolicyKind = 'safe-metadata' | 'replay-payload' | 'logical-request';

export interface JsonPolicy {
  readonly name: string;
  readonly kind: JsonPolicyKind;
  /** UTF-8 bytes of the canonical serialization. */
  readonly maxBytes: number;
  /** Maximum number of nested containers along any path. A scalar has depth 0, `{}` has depth 1. */
  readonly maxDepth: number;
  /** Maximum number of visited values (every scalar, array and object counts once per visit). */
  readonly maxNodes: number;
  readonly rejectSecretKeys: boolean;
}

function policy(name: string, kind: JsonPolicyKind, maxBytes: number): JsonPolicy {
  return Object.freeze({
    name,
    kind,
    maxBytes,
    maxDepth: MAX_JSON_DEPTH,
    maxNodes: MAX_JSON_NODES,
    rejectSecretKeys: kind === 'safe-metadata',
  });
}

export const AUDIT_METADATA_POLICY = policy('audit-metadata', 'safe-metadata', 8 * 1024);
export const REPLAY_GUARD_POLICY = policy('replay-guard', 'safe-metadata', 4 * 1024);
export const OUTBOX_PAYLOAD_POLICY = policy('outbox-payload', 'safe-metadata', 64 * 1024);
export const REPLAY_PAYLOAD_POLICY = policy('replay-payload', 'replay-payload', 64 * 1024);
export const LOGICAL_REQUEST_POLICY = policy('logical-request', 'logical-request', 64 * 1024);

/** A module may use a smaller cap than the ADR hard cap, never a larger one. */
export function withMaxBytes(base: JsonPolicy, maxBytes: number): JsonPolicy {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > base.maxBytes) {
    throw new RangeError('maxBytes must be an integer between 1 and the policy hard cap');
  }
  return Object.freeze({ ...base, maxBytes });
}
