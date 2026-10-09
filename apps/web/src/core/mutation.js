// Mutation coordinator (task FE0 section 6) for the three onboarding writes that carry an Idempotency-Key. One
// "logical attempt" per operation: the key is a UUID made once, the body is a frozen snapshot, and the whole attempt
// lives in memory only.
//
//   same operation + same body while a request is in flight  -> the SAME promise (a double click sends nothing new);
//   the outcome is unknown (network, timeout, 5xx, unreadable 2xx, TRANSACTION_OUTCOME_UNKNOWN, IDEMPOTENCY_BUSY)
//     -> the attempt stays UNKNOWN and a retry sends the SAME key and the SAME body;
//   UNKNOWN and a DIFFERENT body                              -> refused ('unknown_body_changed'): the earlier body may
//     already be committed, so the caller must reconcile (read the server) and call discard() first;
//   the server answered definitively (2xx, or a 4xx other than BUSY) -> the attempt ends; the next submit has a new key.
// A key is never reused with another body, and an attempt of another user is dropped, never replayed.

import { canonicalJson } from './canonical.js';

const UNKNOWN_CODES = new Set(['TRANSACTION_OUTCOME_UNKNOWN', 'IDEMPOTENCY_BUSY', 'IDEMPOTENCY_KEY_UNAVAILABLE']);

function outcomeIsUnknown(result) {
  if (result.ok) {
    return false;
  }
  switch (result.kind) {
    case 'network':
    case 'timeout':
    case 'aborted':
      return true;
    case 'invalid_response':
      // A readable envelope never arrived. For a 2xx or a 5xx the write may have committed. A 4xx with an unreadable
      // body (a proxy or gateway page) was refused before the application ran, so it is a definitive refusal.
      return result.status === undefined || result.status < 400 || result.status >= 500;
    case 'http':
      return result.status >= 500 || UNKNOWN_CODES.has(result.code);
    default:
      return true;
  }
}

export function createMutationCoordinator({ api, uuid }) {
  const attempts = new Map();

  function start(operation, { method, path, body, userId }, key, bodyKey) {
    const attempt = { key, bodyKey, userId, method, path, body, status: 'IN_FLIGHT', promise: null };
    attempts.set(operation, attempt);
    attempt.promise = api
      .request({ method, path, body, idempotencyKey: key })
      .then((result) => {
        if (outcomeIsUnknown(result)) {
          attempt.status = 'UNKNOWN';
        } else {
          // Definitive answer (success or a typed refusal): the logical attempt is over.
          if (attempts.get(operation) === attempt) {
            attempts.delete(operation);
          }
          attempt.status = 'SETTLED';
        }
        return result;
      });
    return attempt.promise;
  }

  return {
    /** spec: { method, path, body (frozen snapshot), userId }. Resolves to the api result, or a local refusal. */
    submit(operation, spec) {
      const bodyKey = canonicalJson(spec.body);
      let current = attempts.get(operation);
      if (current !== undefined && current.userId !== spec.userId) {
        attempts.delete(operation);
        current = undefined;
      }
      if (current !== undefined) {
        if (current.status === 'IN_FLIGHT') {
          return current.bodyKey === bodyKey
            ? current.promise
            : Promise.resolve({ ok: false, kind: 'local', code: 'BUSY', stale: false });
        }
        if (current.status === 'UNKNOWN') {
          if (current.bodyKey !== bodyKey) {
            return Promise.resolve({ ok: false, kind: 'local', code: 'UNKNOWN_BODY_CHANGED', stale: false });
          }
          // Retry: the very same key and the very same frozen body that was sent the first time.
          return start(operation, { method: current.method, path: current.path, body: current.body, userId: current.userId }, current.key, bodyKey);
        }
      }
      return start(operation, spec, uuid(), bodyKey);
    },
    status(operation) {
      return attempts.get(operation)?.status ?? 'NONE';
    },
    hasUnknown(operation) {
      return attempts.get(operation)?.status === 'UNKNOWN';
    },
    /** Forget an attempt after the caller reconciled with the server (or after the user chose to start over). */
    discard(operation) {
      attempts.delete(operation);
    },
    clearAll() {
      attempts.clear();
    },
  };
}
