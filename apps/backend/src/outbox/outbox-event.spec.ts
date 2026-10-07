import { describe, expect, it } from '@jest/globals';
import { JsonValidationError } from '../shared/json/safe-json';
import { codeOf } from '../shared/source-scan.fixture';
import { OutboxEventError, OutboxEventInput, prepareOutboxEvent } from './outbox-event';

function event(overrides: Record<string, unknown> = {}): OutboxEventInput {
  return {
    eventType: 'order.created',
    eventSchemaVersion: 1,
    resourceType: 'order',
    resourceId: 'ord-1',
    resourceVersion: 1,
    payload: { b: 2, a: 1 },
    ...overrides,
  } as OutboxEventInput;
}

function failureOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('prepareOutboxEvent — accepted', () => {
  it('returns the envelope and the canonical payload text', () => {
    const prepared = prepareOutboxEvent(event());
    expect(prepared).toEqual({
      eventType: 'order.created',
      eventSchemaVersion: 1,
      resourceType: 'order',
      resourceId: 'ord-1',
      resourceVersion: 1,
      payloadJson: '{"a":1,"b":2}',
    });
  });

  it('accepts an empty payload object and the schema-version bounds', () => {
    expect(prepareOutboxEvent(event({ payload: {} })).payloadJson).toBe('{}');
    expect(prepareOutboxEvent(event({ eventSchemaVersion: 32767 })).eventSchemaVersion).toBe(32767);
  });
});

describe('prepareOutboxEvent — refused', () => {
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ['an event type without a dot', { eventType: 'created' }, 'event_type'],
    ['an upper-case event type', { eventType: 'Order.Created' }, 'event_type'],
    ['schema version 0', { eventSchemaVersion: 0 }, 'event_schema_version'],
    ['schema version above smallint', { eventSchemaVersion: 32768 }, 'event_schema_version'],
    ['a fractional schema version', { eventSchemaVersion: 1.5 }, 'event_schema_version'],
    ['a string schema version', { eventSchemaVersion: '1' }, 'event_schema_version'],
    ['a bad resource type', { resourceType: 'Order' }, 'resource_type'],
    ['an empty resource id', { resourceId: '' }, 'resource_id'],
    ['a resource id with a space', { resourceId: 'a b' }, 'resource_id'],
    ['resource version 0', { resourceVersion: 0 }, 'resource_version'],
    ['a fractional resource version', { resourceVersion: 1.2 }, 'resource_version'],
    ['an array payload', { payload: [] }, 'payload'],
    ['a null payload', { payload: null }, 'payload'],
    ['a string payload', { payload: 'x' }, 'payload'],
  ];

  it.each<[string, Record<string, unknown>, string]>(refused)('refuses %s', (_label, overrides, field) => {
    const error = failureOf(() => prepareOutboxEvent(event(overrides)));
    expect(error instanceof OutboxEventError).toBe(true);
    expect((error as OutboxEventError).field).toBe(field);
  });

  it('refuses a non-object event', () => {
    for (const value of [null, undefined, 'x', 1, []]) {
      const error = failureOf(() => prepareOutboxEvent(value as unknown as OutboxEventInput));
      expect(error instanceof OutboxEventError).toBe(true);
      expect((error as OutboxEventError).field).toBe('event');
    }
  });

  it.each(['eventId', 'occurredAt', 'status', 'attemptCount', 'availableAt', 'lockedAt', 'lockToken', 'publishedAt', 'lastErrorCode'])(
    'refuses the server-owned field %s instead of ignoring it',
    (name) => {
      const error = failureOf(() => prepareOutboxEvent(event({ [name]: 'x' })));
      expect(error instanceof OutboxEventError).toBe(true);
      expect((error as OutboxEventError).field).toBe('server_owned_field');
    },
  );

  it('refuses any other unknown field', () => {
    const error = failureOf(() => prepareOutboxEvent(event({ extra: 1 })));
    expect((error as OutboxEventError).field).toBe('unknown_field');
  });

  it('error messages never contain the offending value', () => {
    const error = failureOf(() => prepareOutboxEvent(event({ resourceId: 'SECRET_MARKER bad id' }))) as Error;
    expect(error.message).not.toContain('SECRET_MARKER');
  });
});

describe('prepareOutboxEvent — payload goes through the shared safe-JSON validator', () => {
  it.each(['password', 'access_token', 'Authorization', 'cookie', 'database_url'])('refuses the secret key %s (top-level and nested)', (key) => {
    for (const payload of [{ [key]: 'x' }, { a: { b: [{ [key]: 'x' }] } }]) {
      const error = failureOf(() => prepareOutboxEvent(event({ payload })));
      expect(error instanceof JsonValidationError).toBe(true);
      expect((error as JsonValidationError).reason).toBe('secret_key');
    }
  });

  it('refuses a payload over 64 KiB and accepts one just under it', () => {
    const over = failureOf(() => prepareOutboxEvent(event({ payload: { a: 'x'.repeat(64 * 1024) } })));
    expect(over instanceof JsonValidationError).toBe(true);
    expect((over as JsonValidationError).reason).toBe('size');
    expect(() => prepareOutboxEvent(event({ payload: { a: 'x'.repeat(60 * 1024) } }))).not.toThrow();
  });

  it('refuses unsupported values and cycles', () => {
    expect(failureOf(() => prepareOutboxEvent(event({ payload: { a: undefined } })))).toBeInstanceOf(JsonValidationError);
    expect(failureOf(() => prepareOutboxEvent(event({ payload: { a: Number.NaN } })))).toBeInstanceOf(JsonValidationError);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(failureOf(() => prepareOutboxEvent(event({ payload: cyclic })))).toBeInstanceOf(JsonValidationError);
  });

  it('uses the shared validator and policy, with no private copy', () => {
    const code = codeOf('outbox/outbox-event.ts');
    expect(code).toContain("from '../shared/json/safe-json'");
    expect(code).toContain('OUTBOX_PAYLOAD_POLICY');
    expect(code).not.toMatch(/JSON\.stringify|JSON\.parse/);
  });
});
