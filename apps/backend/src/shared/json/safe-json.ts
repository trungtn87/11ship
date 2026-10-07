import { types } from 'node:util';
import { TechnicalError } from '../../common/app-errors';
import { JsonPolicy, LOGICAL_REQUEST_POLICY } from './json-policy';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonRejectReason =
  | 'undefined'
  | 'non_json_type'
  | 'non_finite_number'
  | 'sparse_array'
  | 'accessor'
  | 'custom_prototype'
  | 'proxy'
  | 'symbol_key'
  | 'hidden_property'
  | 'cycle'
  | 'depth'
  | 'node_cap'
  | 'size'
  | 'secret_key';

/** The message carries only the fixed reason: never a key name, a value or a path. */
export class JsonValidationError extends TechnicalError {
  readonly reason: JsonRejectReason;

  constructor(reason: JsonRejectReason) {
    super('internal', `Invalid JSON value (${reason})`);
    this.name = 'JsonValidationError';
    this.reason = reason;
  }
}

export interface ValidatedJson {
  /** Canonical JSON v1 text. */
  readonly canonical: string;
  /** UTF-8 byte length of `canonical`. */
  readonly byteLength: number;
}

const SECRET_KEY_SUFFIXES: readonly string[] = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'databaseurl',
  'connectionstring',
  'proof',
  'credential',
  'credentials',
];
const SECRET_KEY_EXACT: ReadonlySet<string> = new Set(['pwd', 'dsn', 'otp', 'jwt', 'bearer']);

/**
 * Normalizes a key name (Unicode compatibility fold, lower case, letters and digits only) so
 * `accessToken`, `access_token` and `ACCESS-TOKEN` are the same name, then checks a deny-list.
 * This is a defensive last line for metadata, not a guarantee that a payload is free of secrets.
 */
export function isSecretKeyName(key: string): boolean {
  const normalized = key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normalized === '') {
    return false;
  }
  if (SECRET_KEY_EXACT.has(normalized) || normalized.startsWith('otp')) {
    return true;
  }
  return SECRET_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

interface WalkState {
  readonly policy: JsonPolicy;
  readonly ancestors: Set<object>;
  readonly parts: string[];
  nodes: number;
  bytes: number;
}

function emit(state: WalkState, text: string): void {
  state.bytes += Buffer.byteLength(text, 'utf8');
  if (state.bytes > state.policy.maxBytes) {
    throw new JsonValidationError('size');
  }
  state.parts.push(text);
}

function walk(value: unknown, depth: number, state: WalkState): void {
  state.nodes += 1;
  if (state.nodes > state.policy.maxNodes) {
    throw new JsonValidationError('node_cap');
  }

  switch (typeof value) {
    case 'string':
      emit(state, JSON.stringify(value));
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JsonValidationError('non_finite_number');
      }
      // -0 is normalized to 0; every other number follows JSON.stringify.
      emit(state, Object.is(value, -0) ? '0' : JSON.stringify(value));
      return;
    case 'boolean':
      emit(state, value ? 'true' : 'false');
      return;
    case 'undefined':
      throw new JsonValidationError('undefined');
    case 'object':
      break;
    default:
      throw new JsonValidationError('non_json_type');
  }

  if (value === null) {
    emit(state, 'null');
    return;
  }

  // A Proxy could run arbitrary code on any property access, so it is refused before anything else.
  if (types.isProxy(value)) {
    throw new JsonValidationError('proxy');
  }
  if (state.ancestors.has(value)) {
    throw new JsonValidationError('cycle');
  }
  if (depth + 1 > state.policy.maxDepth) {
    throw new JsonValidationError('depth');
  }

  state.ancestors.add(value);
  if (Array.isArray(value)) {
    walkArray(value, depth + 1, state);
  } else {
    walkObject(value, depth + 1, state);
  }
  state.ancestors.delete(value);
}

function walkArray(array: unknown[], depth: number, state: WalkState): void {
  if (Object.getPrototypeOf(array) !== Array.prototype) {
    throw new JsonValidationError('custom_prototype');
  }
  const { length } = array;
  // Checked before iterating so a huge sparse array cannot stall the process.
  if (length > state.policy.maxNodes - state.nodes) {
    throw new JsonValidationError('node_cap');
  }
  if (Object.getOwnPropertySymbols(array).length > 0) {
    throw new JsonValidationError('symbol_key');
  }
  // Own names of a plain array are exactly its indices plus "length".
  const names = Object.getOwnPropertyNames(array);
  if (names.length < length + 1) {
    throw new JsonValidationError('sparse_array');
  }
  if (names.length > length + 1) {
    throw new JsonValidationError('hidden_property');
  }

  emit(state, '[');
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (descriptor === undefined) {
      throw new JsonValidationError('sparse_array');
    }
    if (!('value' in descriptor)) {
      throw new JsonValidationError('accessor');
    }
    if (index > 0) {
      emit(state, ',');
    }
    walk(descriptor.value, depth, state);
  }
  emit(state, ']');
}

function walkObject(object: object, depth: number, state: WalkState): void {
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new JsonValidationError('custom_prototype');
  }
  if (Object.getOwnPropertySymbols(object).length > 0) {
    throw new JsonValidationError('symbol_key');
  }
  const names = Object.getOwnPropertyNames(object);
  if (names.length > state.policy.maxNodes - state.nodes) {
    throw new JsonValidationError('node_cap');
  }

  // Default sort compares UTF-16 code units, which is what Canonical JSON v1 requires. The text is
  // written key by key, so numeric-looking keys are NOT re-ordered the way JSON.stringify would.
  names.sort();

  emit(state, '{');
  names.forEach((name, position) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      // Accessors are never invoked: no getter of untrusted input is ever run.
      throw new JsonValidationError('accessor');
    }
    if (!descriptor.enumerable) {
      throw new JsonValidationError('hidden_property');
    }
    if (state.policy.rejectSecretKeys && isSecretKeyName(name)) {
      throw new JsonValidationError('secret_key');
    }
    if (position > 0) {
      emit(state, ',');
    }
    emit(state, JSON.stringify(name));
    emit(state, ':');
    walk(descriptor.value, depth, state);
  });
  emit(state, '}');
}

/**
 * Validates `value` against `policy` and returns its Canonical JSON v1 text.
 * Traversal limits (depth, node count, running byte size) are enforced WHILE walking, before any
 * large string exists. Getters, toJSON and Proxy traps of the input are never run.
 */
export function validateJson(value: unknown, policy: JsonPolicy): ValidatedJson {
  const state: WalkState = { policy, ancestors: new Set(), parts: [], nodes: 0, bytes: 0 };
  walk(value, 0, state);
  return { canonical: state.parts.join(''), byteLength: state.bytes };
}

/** Canonical JSON v1 for a value that is not secret-scanned (HMAC input, AAD, lock tuples). */
export function canonicalJson(value: unknown, policy: JsonPolicy = LOGICAL_REQUEST_POLICY): string {
  return validateJson(value, policy).canonical;
}
