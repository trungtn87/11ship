import { TechnicalError } from '../common/app-errors';
import {
  DOTTED_NAME_MAX_LENGTH,
  DOTTED_NAME_PATTERN,
  isResourceVersion,
  matches,
  MAX_EVENT_SCHEMA_VERSION,
  RESOURCE_TYPE_MAX_LENGTH,
  RESOURCE_TYPE_PATTERN,
  SAFE_ID_MAX_LENGTH,
  SAFE_ID_PATTERN,
} from '../shared/identifiers';
import { isJsonObjectShape, JsonObject } from '../shared/json/json-object';
import { OUTBOX_PAYLOAD_POLICY } from '../shared/json/json-policy';
import { validateJson } from '../shared/json/safe-json';

/** Identifier of an outbox event. The writer generates it; the caller never supplies one. */
export type EventId = string;

/**
 * The immutable business envelope of an event: what happened, to which resource version, and a small
 * safe payload. Delivery state (status, attempts, availability, lease, publication, last error) is NOT
 * part of it: it belongs to the dispatcher and is created by the writer in its initial state only.
 */
export interface OutboxEventInput {
  /** Stable dotted event name such as `order.created`. */
  readonly eventType: string;
  /** Shape version of the payload, a positive integer (smallint). */
  readonly eventSchemaVersion: number;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Version of the resource this event describes; lets a consumer recognize a stale event. */
  readonly resourceVersion: number;
  /** Small safe JSON object, checked against OUTBOX_PAYLOAD_POLICY (64 KiB canonical, depth 8). */
  readonly payload: JsonObject;
}

export type OutboxEventField =
  | 'event'
  | 'unknown_field'
  | 'server_owned_field'
  | 'event_type'
  | 'event_schema_version'
  | 'resource_type'
  | 'resource_id'
  | 'resource_version'
  | 'payload';

/** The message carries only the fixed field name: never the offending value. */
export class OutboxEventError extends TechnicalError {
  readonly field: OutboxEventField;

  constructor(field: OutboxEventField) {
    super('internal', `Invalid outbox event (${field})`);
    this.name = 'OutboxEventError';
    this.field = field;
  }
}

export interface PreparedOutboxEvent {
  readonly eventType: string;
  readonly eventSchemaVersion: number;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  /** Canonical JSON v1 text, already checked against OUTBOX_PAYLOAD_POLICY. */
  readonly payloadJson: string;
}

const ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  'eventType',
  'eventSchemaVersion',
  'resourceType',
  'resourceId',
  'resourceVersion',
  'payload',
]);

/**
 * Fields that only the writer or the dispatcher may set. Passing one is refused outright (not ignored),
 * so a caller can never create an event that starts in any state other than the initial one.
 */
const SERVER_OWNED_FIELDS: ReadonlySet<string> = new Set([
  'eventId',
  'occurredAt',
  'status',
  'attemptCount',
  'availableAt',
  'lockedAt',
  'lockToken',
  'publishedAt',
  'lastErrorCode',
]);

/**
 * Validates a WHOLE event before anything touches the database. Nothing is repaired, trimmed or
 * truncated. The payload check is the shared bounded JSON validator with OUTBOX_PAYLOAD_POLICY.
 */
export function prepareOutboxEvent(event: OutboxEventInput): PreparedOutboxEvent {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new OutboxEventError('event');
  }
  for (const key of Object.keys(event)) {
    if (SERVER_OWNED_FIELDS.has(key)) {
      throw new OutboxEventError('server_owned_field');
    }
    if (!ENVELOPE_FIELDS.has(key)) {
      throw new OutboxEventError('unknown_field');
    }
  }

  if (!matches(event.eventType, DOTTED_NAME_PATTERN, DOTTED_NAME_MAX_LENGTH)) {
    throw new OutboxEventError('event_type');
  }
  if (
    typeof event.eventSchemaVersion !== 'number' ||
    !Number.isInteger(event.eventSchemaVersion) ||
    event.eventSchemaVersion < 1 ||
    event.eventSchemaVersion > MAX_EVENT_SCHEMA_VERSION
  ) {
    throw new OutboxEventError('event_schema_version');
  }
  if (!matches(event.resourceType, RESOURCE_TYPE_PATTERN, RESOURCE_TYPE_MAX_LENGTH)) {
    throw new OutboxEventError('resource_type');
  }
  if (!matches(event.resourceId, SAFE_ID_PATTERN, SAFE_ID_MAX_LENGTH)) {
    throw new OutboxEventError('resource_id');
  }
  if (!isResourceVersion(event.resourceVersion)) {
    throw new OutboxEventError('resource_version');
  }
  if (!isJsonObjectShape(event.payload)) {
    throw new OutboxEventError('payload');
  }
  // Throws JsonValidationError (fixed reason, never the key or the value) on any violation.
  const { canonical } = validateJson(event.payload, OUTBOX_PAYLOAD_POLICY);

  return {
    eventType: event.eventType,
    eventSchemaVersion: event.eventSchemaVersion,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    resourceVersion: event.resourceVersion,
    payloadJson: canonical,
  };
}
