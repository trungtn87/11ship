import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK_CTE, toSafeInteger } from './driver-db';

export type DriverActorType = 'DRIVER' | 'ADMIN' | 'SYSTEM';

export interface NewDriverEvent {
  readonly driverId: string;
  /** Dotted lower-case name, e.g. `profile.submitted`. */
  readonly eventType: string;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly fromReviewState?: string | null;
  readonly toReviewState?: string | null;
  readonly actorType: DriverActorType;
  readonly actorId: string | null;
  readonly reason?: string | null;
  /** Small safe object: never a bank account number, a phone number or a name. */
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DriverEventRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly fromReviewState: string | null;
  readonly toReviewState: string | null;
  readonly actorType: DriverActorType;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly detail: Record<string, unknown>;
  readonly createdAtMs: number;
}

/** SQL for app.driver_events: append-only history of what happened to a driver. */
@Injectable()
export class DriverEventRepository {
  async append(context: TransactionContext, event: NewDriverEvent): Promise<void> {
    await context.query(
      `INSERT INTO app.driver_events (event_id, driver_id, event_type, from_status, to_status, from_review_state, to_review_state,
                                      actor_type, actor_id, reason, detail, created_at)
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11::jsonb, clock.t FROM (${CLOCK_CTE}) AS clock`,
      [
        randomUUID(),
        event.driverId,
        event.eventType,
        event.fromStatus ?? null,
        event.toStatus ?? null,
        event.fromReviewState ?? null,
        event.toReviewState ?? null,
        event.actorType,
        event.actorId,
        event.reason ?? null,
        JSON.stringify(event.detail ?? {}),
      ],
    );
  }

  /** Newest first. */
  async list(context: TransactionContext, driverId: string, limit: number): Promise<DriverEventRow[]> {
    const result = await context.query<{
      event_id: string;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      from_review_state: string | null;
      to_review_state: string | null;
      actor_type: DriverActorType;
      actor_id: string | null;
      reason: string | null;
      detail: Record<string, unknown>;
      created_ms: string;
    }>(
      `SELECT event_id, event_type, from_status, to_status, from_review_state, to_review_state, actor_type, actor_id::text AS actor_id, reason, detail,
              (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms
         FROM app.driver_events WHERE driver_id = $1::uuid ORDER BY created_at DESC, event_id LIMIT $2::int`,
      [driverId, limit],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromReviewState: row.from_review_state,
      toReviewState: row.to_review_state,
      actorType: row.actor_type,
      actorId: row.actor_id,
      reason: row.reason,
      detail: row.detail,
      createdAtMs: toSafeInteger(row.created_ms),
    }));
  }
}
