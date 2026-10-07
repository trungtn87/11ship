import { describe, expect, it } from '@jest/globals';
import { AUDIT_METADATA_POLICY } from '../shared/json/json-policy';
import { JsonValidationError, validateJson } from '../shared/json/safe-json';
import { codeOf } from '../shared/source-scan.fixture';
import { AuditEntry, AuditEntryError, prepareAuditEntry } from './audit-entry';

const REQUEST_ID = '3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34';
const MARKER = 'SECRET_MARKER_AUDIT_ENTRY_5c2a';

function entry(overrides: Record<string, unknown> = {}): AuditEntry {
  return {
    requestId: REQUEST_ID,
    actorType: 'USER',
    actorId: 'u-1',
    action: 'auth.register.v1',
    resourceType: 'user',
    resourceId: 'u-1',
    resourceVersion: 1,
    outcome: 'SUCCESS',
    metadata: { step: 'created' },
    ...overrides,
  } as AuditEntry;
}

/** What prepareAuditEntry refuses with: the audit field, or the JSON validator's fixed reason. */
function refusal(value: unknown): string {
  try {
    prepareAuditEntry(value as AuditEntry);
  } catch (error) {
    if (error instanceof AuditEntryError) {
      return error.field;
    }
    if (error instanceof JsonValidationError) {
      return `json:${error.reason}`;
    }
    throw error;
  }
  return 'accepted';
}

function nested(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let level = 1; level < levels; level += 1) {
    value = { a: value };
  }
  return value;
}

describe('prepareAuditEntry — accepted entries', () => {
  it('accepts a complete SUCCESS entry and returns the exact INSERT shape', () => {
    expect(prepareAuditEntry(entry())).toEqual({
      requestId: REQUEST_ID,
      actorType: 'USER',
      actorId: 'u-1',
      action: 'auth.register.v1',
      resourceType: 'user',
      resourceId: 'u-1',
      resourceVersion: 1,
      outcome: 'SUCCESS',
      reasonCode: null,
      metadataJson: '{"step":"created"}',
    });
  });

  it('accepts an anonymous denial: no actor id, no resource, a reason code', () => {
    const prepared = prepareAuditEntry({
      requestId: REQUEST_ID,
      actorType: 'ANONYMOUS',
      action: 'auth.login.v1',
      outcome: 'DENIED',
      reasonCode: 'INVALID_CREDENTIALS',
    });
    expect(prepared.actorId).toBeNull();
    expect(prepared.resourceType).toBeNull();
    expect(prepared.resourceId).toBeNull();
    expect(prepared.resourceVersion).toBeNull();
    expect(prepared.metadataJson).toBe('{}');
  });

  it('accepts a resource type alone (the action touched a kind of resource but not a specific one)', () => {
    expect(refusal(entry({ resourceId: null, resourceVersion: null, outcome: 'DENIED', reasonCode: 'FORBIDDEN' }))).toBe(
      'accepted',
    );
  });

  it('lets SUCCESS carry an optional reason code', () => {
    expect(refusal(entry({ reasonCode: 'FIRST_LOGIN' }))).toBe('accepted');
  });

  it('writes the metadata as canonical JSON (sorted keys), the same text the shared validator produces', () => {
    const metadata = { b: 1, a: { d: [3, 1], c: null } };
    const prepared = prepareAuditEntry(entry({ metadata }));
    expect(prepared.metadataJson).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
    expect(prepared.metadataJson).toBe(validateJson(metadata, AUDIT_METADATA_POLICY).canonical);
  });

  it.each(['ANONYMOUS', 'USER', 'ADMIN', 'SYSTEM', 'X', 'DRIVER_APP_2'])('accepts the actor type token %s', (actorType) => {
    expect(refusal(entry({ actorType }))).toBe('accepted');
  });
});

describe('prepareAuditEntry — refused entries (nothing is repaired or truncated)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['a request id that is not a UUID', { requestId: 'req-123' }, 'request_id'],
    ['an upper-case request id', { requestId: REQUEST_ID.toUpperCase() }, 'request_id'],
    ['the nil UUID as request id', { requestId: '00000000-0000-0000-0000-000000000000' }, 'request_id'],
    ['a missing request id', { requestId: undefined }, 'request_id'],
    ['a numeric request id', { requestId: 123 }, 'request_id'],
    ['a lower-case actor type', { actorType: 'user' }, 'actor_type'],
    ['an actor type with a space', { actorType: 'USER ' }, 'actor_type'],
    ['an actor type starting with a digit', { actorType: '1USER' }, 'actor_type'],
    ['an empty actor type', { actorType: '' }, 'actor_type'],
    ['a 33 character actor type', { actorType: 'A'.repeat(33) }, 'actor_type'],
    ['an actor id with a space', { actorId: 'a b' }, 'actor_id'],
    ['an empty actor id', { actorId: '' }, 'actor_id'],
    ['a numeric actor id', { actorId: 7 }, 'actor_id'],
    ['a 129 character actor id', { actorId: 'a'.repeat(129) }, 'actor_id'],
    ['a URL path as action', { action: '/api/v1/auth/register' }, 'action'],
    ['an absolute URL as action', { action: 'https://example.test/register' }, 'action'],
    ['a single-segment action', { action: 'register' }, 'action'],
    ['an upper-case action', { action: 'Auth.Register.v1' }, 'action'],
    ['an action with an empty segment', { action: 'auth..register' }, 'action'],
    ['an action with a trailing space', { action: 'auth.register.v1 ' }, 'action'],
    ['an action with a trailing newline', { action: 'auth.register.v1\n' }, 'action'],
    ['a 129 character action', { action: `a.${'b'.repeat(127)}` }, 'action'],
    ['an upper-case resource type', { resourceType: 'User' }, 'resource_type'],
    ['an empty resource type', { resourceType: '' }, 'resource_type'],
    ['a 65 character resource type', { resourceType: 'a'.repeat(65) }, 'resource_type'],
    ['a path-like resource id', { resourceId: '../etc/passwd' }, 'resource_id'],
    ['an empty resource id', { resourceId: '' }, 'resource_id'],
    ['a 129 character resource id', { resourceId: 'a'.repeat(129) }, 'resource_id'],
    ['resource version 0', { resourceVersion: 0 }, 'resource_version'],
    ['a negative resource version', { resourceVersion: -1 }, 'resource_version'],
    ['a fractional resource version', { resourceVersion: 1.5 }, 'resource_version'],
    ['a string resource version', { resourceVersion: '1' }, 'resource_version'],
    ['NaN as resource version', { resourceVersion: Number.NaN }, 'resource_version'],
    ['an unsafe integer resource version', { resourceVersion: 2 ** 53 }, 'resource_version'],
    ['a resource id without a resource type', { resourceType: null, resourceVersion: null }, 'resource_shape'],
    ['a resource version without a resource type', { resourceType: null, resourceId: null }, 'resource_shape'],
    ['a resource version without a resource id', { resourceId: null }, 'resource_shape'],
    ['an unknown outcome', { outcome: 'OK' }, 'outcome'],
    ['a lower-case outcome', { outcome: 'success' }, 'outcome'],
    ['a missing outcome', { outcome: undefined }, 'outcome'],
    ['a lower-case reason code', { outcome: 'DENIED', reasonCode: 'forbidden' }, 'reason_code'],
    ['a raw message as reason code', { outcome: 'FAILURE', reasonCode: 'duplicate key value violates constraint' }, 'reason_code'],
    ['a 65 character reason code', { outcome: 'DENIED', reasonCode: 'A'.repeat(65) }, 'reason_code'],
    ['a DENIED entry without a reason code', { outcome: 'DENIED' }, 'reason_code'],
    ['a FAILURE entry without a reason code', { outcome: 'FAILURE', reasonCode: null }, 'reason_code'],
    ['metadata that is an array', { metadata: [] }, 'metadata'],
    ['metadata that is null', { metadata: null }, 'metadata'],
    ['metadata that is a string', { metadata: 'text' }, 'metadata'],
  ];

  it.each<[string, Record<string, unknown>, string]>(cases)('refuses %s', (_label, overrides, field) => {
    expect(refusal(entry(overrides))).toBe(field);
  });

  it('refuses anything that is not an object as the whole entry', () => {
    for (const value of [null, undefined, 'entry', 7, []]) {
      expect(refusal(value)).toBe('entry');
    }
  });

  it.each(['body', 'ip', 'headers', 'request', 'dto', 'password', 'occurredAt', 'auditId'])(
    'refuses the extra field %s instead of filtering it (no request DTO can be passed through)',
    (key) => {
      expect(refusal(entry({ [key]: { anything: 1 } }))).toBe('unknown_field');
    },
  );

  it('never puts the offending value, key or field content into the error message', () => {
    const badValues: Array<Record<string, unknown>> = [
      { requestId: MARKER },
      { actorType: MARKER },
      { actorId: `${MARKER} spaced` },
      { action: `/${MARKER}` },
      { resourceType: MARKER.toUpperCase() },
      { resourceId: `${MARKER}/x` },
      { outcome: MARKER, reasonCode: 'X' },
      { outcome: 'DENIED', reasonCode: MARKER.toLowerCase() },
      { [MARKER]: 1 },
      { metadata: { [`${MARKER}_password`]: MARKER } },
    ];
    for (const overrides of badValues) {
      let message = '';
      try {
        prepareAuditEntry(entry(overrides));
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(MARKER);
      expect(message).not.toContain(MARKER.toLowerCase());
      expect(message).not.toContain(MARKER.toUpperCase());
    }
  });
});

describe('prepareAuditEntry — metadata goes through the shared safe-JSON policy (C26)', () => {
  const secretKeys = [
    'password',
    'Password',
    'access_token',
    'accessToken',
    'ACCESS-TOKEN',
    'refresh.token',
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'database_url',
    'DATABASE_URL',
    'verification_token',
    'otp_code',
    'client_secret',
  ];

  it.each(secretKeys)('rejects the secret key %s at the top level, nested and inside an array', (name) => {
    expect(refusal(entry({ metadata: { [name]: 'x' } }))).toBe('json:secret_key');
    expect(refusal(entry({ metadata: { outer: { inner: { [name]: 'x' } } } }))).toBe('json:secret_key');
    expect(refusal(entry({ metadata: { list: [{ ok: 1 }, { [name]: 'x' }] } }))).toBe('json:secret_key');
  });

  it('does not reject ordinary key names', () => {
    expect(
      refusal(
        entry({
          metadata: { user_id: 'u', step: 'created', tokens_issued: 1, password_changed_at: '2026-10-07', device: { os: 'android' } },
        }),
      ),
    ).toBe('accepted');
  });

  it('accepts exactly 8 KiB of canonical JSON and rejects one byte more, counting UTF-8 bytes', () => {
    // {"a":"..."} is 8 bytes of framing around the string.
    expect(refusal(entry({ metadata: { a: 'x'.repeat(8 * 1024 - 8) } }))).toBe('accepted');
    expect(refusal(entry({ metadata: { a: 'x'.repeat(8 * 1024 - 7) } }))).toBe('json:size');
    // 2049 emoji are 4098 UTF-16 units but 8196 UTF-8 bytes.
    expect(refusal(entry({ metadata: { a: '\u{1F600}'.repeat(2049) } }))).toBe('json:size');
  });

  it('allows depth 8 and rejects depth 9 (the metadata object itself is level 1)', () => {
    expect(refusal(entry({ metadata: nested(8) }))).toBe('accepted');
    expect(refusal(entry({ metadata: nested(9) }))).toBe('json:depth');
  });

  it('stops at the node cap before iterating a huge sparse array', () => {
    expect(AUDIT_METADATA_POLICY.maxNodes).toBe(65_536);
    expect(refusal(entry({ metadata: { list: new Array<number>(2 ** 31) } }))).toBe('json:node_cap');
  });

  it.each<[string, unknown, string]>([
    ['undefined', { a: undefined }, 'json:undefined'],
    ['NaN', { a: Number.NaN }, 'json:non_finite_number'],
    ['Infinity', { a: Number.POSITIVE_INFINITY }, 'json:non_finite_number'],
    ['bigint', { a: 1n }, 'json:non_json_type'],
    ['symbol', { a: Symbol('x') }, 'json:non_json_type'],
    ['function', { a: () => 1 }, 'json:non_json_type'],
    ['Date', { a: new Date(0) }, 'json:custom_prototype'],
    ['Map', { a: new Map() }, 'json:custom_prototype'],
    ['Buffer', { a: Buffer.from('x') }, 'json:custom_prototype'],
    ['a sparse array', { a: [1, , 3] }, 'json:sparse_array'],
    ['a class instance (a request DTO)', new (class RegisterDto { phone = '0901'; })(), 'json:custom_prototype'],
  ])('rejects unsupported value: %s', (_label, metadata, reason) => {
    expect(refusal(entry({ metadata }))).toBe(reason);
  });

  it('rejects a cycle', () => {
    const self: Record<string, unknown> = {};
    self.me = self;
    expect(refusal(entry({ metadata: self }))).toBe('json:cycle');
  });

  it('is a thin layer over the SHARED validator, not a private copy of it', () => {
    const code = codeOf('audit/audit-entry.ts');
    expect(code).toContain("from '../shared/json/safe-json'");
    expect(code).toContain("from '../shared/json/json-policy'");
    expect(code).toContain('validateJson(metadata, AUDIT_METADATA_POLICY)');
    // No local secret-key list, no local size/depth walker.
    expect(code).not.toMatch(/password|token|cookie|authorization|database_?url/i);
    expect(code).not.toMatch(/maxDepth|maxNodes|byteLength|Buffer\./);
  });
});
