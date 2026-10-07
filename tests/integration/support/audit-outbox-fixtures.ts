import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuditEntry, StandaloneAuditEntry } from '../../../apps/backend/src/audit/audit-entry';
import { OutboxEventInput } from '../../../apps/backend/src/outbox/outbox-event';
import { JsonLogger } from '../../../apps/backend/src/logging/json-logger';

// Shared fixtures of the M00-C1B integration suites (real PostgreSQL). app.audit_logs is append-only, so
// tests can never delete their rows: every test isolates itself with a random request id (audit) or a
// random resource id (outbox) instead, and asserts only on its own rows.

export const SECRET_MARKER = 'SECRET_MARKER_C1B_4f9a';

export function newRequestId(): string {
  return randomUUID();
}

export function newResourceId(): string {
  return `r-${randomUUID().slice(0, 12)}`;
}

export function auditEntry(requestId: string, overrides: Record<string, unknown> = {}): AuditEntry {
  return {
    requestId,
    actorType: 'USER',
    actorId: 'u-1',
    action: 'fixture.create.v1',
    resourceType: 'fixture_item',
    resourceId: 'item-1',
    resourceVersion: 1,
    outcome: 'SUCCESS',
    metadata: { step: 'created' },
    ...overrides,
  } as AuditEntry;
}

export function denial(requestId: string, overrides: Record<string, unknown> = {}): StandaloneAuditEntry {
  return auditEntry(requestId, {
    actorType: 'ANONYMOUS',
    actorId: null,
    resourceType: null,
    resourceId: null,
    resourceVersion: null,
    outcome: 'DENIED',
    reasonCode: 'ACCESS_DENIED',
    ...overrides,
  }) as StandaloneAuditEntry;
}

export function outboxEvent(resourceId: string, overrides: Record<string, unknown> = {}): OutboxEventInput {
  return {
    eventType: 'fixture.created',
    eventSchemaVersion: 1,
    resourceType: 'fixture_item',
    resourceId,
    resourceVersion: 1,
    payload: { label: 'one' },
    ...overrides,
  } as OutboxEventInput;
}

export interface AuditRow {
  audit_id: string;
  occurred_at: Date;
  request_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_version: string | null;
  outcome: string;
  reason_code: string | null;
  metadata: Record<string, unknown>;
}

export async function auditRowsOf(pool: Pool, requestId: string): Promise<AuditRow[]> {
  const result = await pool.query<AuditRow>(
    `SELECT audit_id, occurred_at, request_id, actor_type, actor_id, action, resource_type, resource_id,
            resource_version, outcome, reason_code, metadata
       FROM app.audit_logs WHERE request_id = $1 ORDER BY occurred_at, audit_id`,
    [requestId],
  );
  return result.rows;
}

export async function auditCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.audit_logs');
  return result.rows[0]?.n ?? -1;
}

export interface OutboxRow {
  event_id: string;
  event_type: string;
  event_schema_version: number;
  resource_type: string;
  resource_id: string;
  resource_version: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  available_at: Date;
  locked_at: Date | null;
  lock_token: string | null;
  published_at: Date | null;
  last_error_code: string | null;
}

export async function outboxRowsOf(pool: Pool, resourceId: string): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    `SELECT event_id, event_type, event_schema_version, resource_type, resource_id, resource_version,
            occurred_at, payload, status, attempt_count, available_at, locked_at, lock_token,
            published_at, last_error_code
       FROM app.outbox_events WHERE resource_id = $1 ORDER BY occurred_at, event_id`,
    [resourceId],
  );
  return result.rows;
}

/** Database clock window around an operation: the row's occurred_at must fall inside it. */
export async function dbClockMs(pool: Pool): Promise<number> {
  const result = await pool.query<{ ms: string }>(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms',
  );
  return Number(result.rows[0]?.ms);
}

export interface CapturedLogs {
  readonly logger: JsonLogger;
  readonly lines: string[];
}

/** A REAL JsonLogger writing into an array, so the whitelist/sanitization is part of what is proven. */
export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  return {
    lines,
    logger: new JsonLogger((line) => {
      lines.push(line);
    }),
  };
}

export class ThrowingMarkerError extends Error {
  constructor() {
    super(`driver says: ${SECRET_MARKER}`);
    this.name = 'ThrowingMarkerError';
  }
}
