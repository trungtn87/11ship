import { JsonValue } from './safe-json';

/** A JSON object: the only top-level shape audit metadata and outbox payloads may have. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Structural pre-check only (is it an object and not an array or null). Everything else (prototype,
 * accessors, depth, size, secret key names) is decided by the shared validator against the policy.
 */
export function isJsonObjectShape(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
