import { TechnicalError } from '../common/app-errors';
import {
  ACTOR_TYPE_MAX_LENGTH,
  ACTOR_TYPE_PATTERN,
  CODE_MAX_LENGTH,
  CODE_PATTERN,
  DOTTED_NAME_MAX_LENGTH,
  DOTTED_NAME_PATTERN,
  isCanonicalUuid,
  isResourceVersion,
  matches,
  RESOURCE_TYPE_MAX_LENGTH,
  RESOURCE_TYPE_PATTERN,
  SAFE_ID_MAX_LENGTH,
  SAFE_ID_PATTERN,
} from '../shared/identifiers';
import { AUDIT_METADATA_POLICY } from '../shared/json/json-policy';
import { isJsonObjectShape, JsonObject } from '../shared/json/json-object';
import { validateJson } from '../shared/json/safe-json';

export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILURE';

export const AUDIT_OUTCOMES: readonly AuditOutcome[] = Object.freeze(['SUCCESS', 'DENIED', 'FAILURE']);

/**
 * One audited action, described only by values the SERVER derived: the request id comes from the request
 * context, the actor from the authenticated principal, the resource from the mutation. Never a request
 * DTO and never a raw header.
 */
export interface AuditEntry {
  /** Server-generated UUID of the request context (never a client header). */
  readonly requestId: string;
  /** Server-derived actor kind, an UPPER_SNAKE token (ANONYMOUS, USER, ADMIN, SYSTEM, ...). */
  readonly actorType: string;
  /** Server-derived actor id; absent for pre-auth and anonymous denials. */
  readonly actorId?: string | null;
  /** Stable dotted action name such as `auth.register.v1`. Never a URL or path. */
  readonly action: string;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly resourceVersion?: number | null;
  readonly outcome: AuditOutcome;
  /** Short stable code. Mandatory for DENIED and FAILURE; never a raw exception message. */
  readonly reasonCode?: string | null;
  /** Small, action-specific, safe JSON object. Defaults to `{}`. */
  readonly metadata?: JsonObject;
}

/** What may be written by the standalone path: a failed or denied attempt, always with a reason. */
export interface StandaloneAuditEntry extends Omit<AuditEntry, 'outcome' | 'reasonCode'> {
  readonly outcome: 'DENIED' | 'FAILURE';
  readonly reasonCode: string;
}

export type AuditEntryField =
  | 'entry'
  | 'unknown_field'
  | 'request_id'
  | 'actor_type'
  | 'actor_id'
  | 'action'
  | 'resource_type'
  | 'resource_id'
  | 'resource_version'
  | 'resource_shape'
  | 'outcome'
  | 'reason_code'
  | 'metadata';

/** The message carries only the fixed field name: never the offending value. */
export class AuditEntryError extends TechnicalError {
  readonly field: AuditEntryField;

  constructor(field: AuditEntryField) {
    super('internal', `Invalid audit entry (${field})`);
    this.name = 'AuditEntryError';
    this.field = field;
  }
}

/** An entry that passed every check, in the exact shape the INSERT needs. */
export interface PreparedAuditEntry {
  readonly requestId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly resourceVersion: number | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  /** Canonical JSON v1 text of the metadata object, already checked against AUDIT_METADATA_POLICY. */
  readonly metadataJson: string;
}

const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'requestId',
  'actorType',
  'actorId',
  'action',
  'resourceType',
  'resourceId',
  'resourceVersion',
  'outcome',
  'reasonCode',
  'metadata',
]);

function absent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

/**
 * Validates a WHOLE entry before anything touches the database. It never repairs, trims, truncates or
 * sanitizes: an invalid entry is rejected, so a SUCCESS audit can never be silently weaker than what the
 * caller asked for (the surrounding transaction rolls back instead).
 *
 * The metadata check is the shared bounded JSON validator with AUDIT_METADATA_POLICY (8 KiB canonical,
 * depth 8, node cap, secret-looking key names refused). It is a last-line structural guard, NOT a PII
 * classifier: which keys an action may carry is decided by the module that audits.
 */
export function prepareAuditEntry(entry: AuditEntry): PreparedAuditEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new AuditEntryError('entry');
  }
  // A request DTO (or anything else that is not the declared envelope) is refused, not filtered.
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new AuditEntryError('unknown_field');
    }
  }

  if (!isCanonicalUuid(entry.requestId)) {
    throw new AuditEntryError('request_id');
  }
  if (!matches(entry.actorType, ACTOR_TYPE_PATTERN, ACTOR_TYPE_MAX_LENGTH)) {
    throw new AuditEntryError('actor_type');
  }
  if (!absent(entry.actorId) && !matches(entry.actorId, SAFE_ID_PATTERN, SAFE_ID_MAX_LENGTH)) {
    throw new AuditEntryError('actor_id');
  }
  if (!matches(entry.action, DOTTED_NAME_PATTERN, DOTTED_NAME_MAX_LENGTH)) {
    throw new AuditEntryError('action');
  }

  if (!absent(entry.resourceType) && !matches(entry.resourceType, RESOURCE_TYPE_PATTERN, RESOURCE_TYPE_MAX_LENGTH)) {
    throw new AuditEntryError('resource_type');
  }
  if (!absent(entry.resourceId) && !matches(entry.resourceId, SAFE_ID_PATTERN, SAFE_ID_MAX_LENGTH)) {
    throw new AuditEntryError('resource_id');
  }
  if (!absent(entry.resourceVersion) && !isResourceVersion(entry.resourceVersion)) {
    throw new AuditEntryError('resource_version');
  }
  // An id or version without a type is meaningless, and so is a version without an id.
  if (
    (absent(entry.resourceType) && (!absent(entry.resourceId) || !absent(entry.resourceVersion))) ||
    (!absent(entry.resourceVersion) && absent(entry.resourceId))
  ) {
    throw new AuditEntryError('resource_shape');
  }

  if (!AUDIT_OUTCOMES.includes(entry.outcome)) {
    throw new AuditEntryError('outcome');
  }
  if (!absent(entry.reasonCode) && !matches(entry.reasonCode, CODE_PATTERN, CODE_MAX_LENGTH)) {
    throw new AuditEntryError('reason_code');
  }
  // SUCCESS may omit the reason; a denial or failure without one says nothing useful.
  if (entry.outcome !== 'SUCCESS' && absent(entry.reasonCode)) {
    throw new AuditEntryError('reason_code');
  }

  const metadata = entry.metadata === undefined ? {} : entry.metadata;
  if (!isJsonObjectShape(metadata)) {
    throw new AuditEntryError('metadata');
  }
  // Throws JsonValidationError (fixed reason, never the key or the value) on any violation.
  const { canonical } = validateJson(metadata, AUDIT_METADATA_POLICY);

  return {
    requestId: entry.requestId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    resourceVersion: entry.resourceVersion ?? null,
    outcome: entry.outcome,
    reasonCode: entry.reasonCode ?? null,
    metadataJson: canonical,
  };
}
