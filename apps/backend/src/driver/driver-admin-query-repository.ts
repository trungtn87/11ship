import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { DRIVER_COLUMNS, DriverRow, RawDriver, toDriver } from './driver-repository';
import { BankVerificationState } from './driver-types';

/** The list filter of the administration web. DRAFT / SUBMITTED / REJECTED are the review steps of a PENDING driver. */
export const SHIPPER_LIST_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'] as const;
export type ShipperListStatus = (typeof SHIPPER_LIST_STATUSES)[number];

export interface ShipperListFilter {
  /**
   * Search text, already reduced to LIKE patterns by the parser: `name` is the folded text (marks removed, compared with app.fold_vi),
   * `code` the text as typed (matched case-insensitively against the Shipper code) and `phone` the digits when the text looks like a
   * phone number. A row matches when ANY of them matches. All null = no search.
   */
  readonly pattern: { readonly name: string; readonly code: string; readonly phone: string | null } | null;
  readonly status: ShipperListStatus | null;
}

export interface ShipperListRow {
  readonly driver: DriverRow;
  readonly phone: string;
  readonly bankState: BankVerificationState | null;
  readonly bankName: string | null;
}

type RawListRow = RawDriver & { phone: string; bank_state: BankVerificationState | null; bank_name: string | null };

function where(filter: ShipperListFilter): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filter.pattern !== null) {
    params.push(filter.pattern.name, filter.pattern.code);
    const alternatives = [`app.fold_vi(d.full_name) LIKE $${params.length - 1}`, `d.shipper_code ILIKE $${params.length}`];
    if (filter.pattern.phone !== null) {
      params.push(filter.pattern.phone);
      alternatives.push(`u.phone_normalized LIKE $${params.length}`);
    }
    parts.push(`(${alternatives.join(' OR ')})`);
  }
  if (filter.status !== null) {
    if (filter.status === 'DRAFT' || filter.status === 'SUBMITTED' || filter.status === 'REJECTED') {
      params.push(filter.status);
      parts.push(`(d.status = 'PENDING' AND d.review_state = $${params.length})`);
    } else {
      params.push(filter.status);
      parts.push(`d.status = $${params.length}`);
    }
  }
  return { clause: parts.length === 0 ? '' : `WHERE ${parts.join(' AND ')}`, params };
}

/**
 * Read model of the administration web over app.drivers (M03 owns the table, so the join to app.users for the phone number and to
 * the bank account lives here). Plain reads, no locks.
 */
@Injectable()
export class DriverAdminQueryRepository {
  async count(context: TransactionContext, filter: ShipperListFilter): Promise<number> {
    const { clause, params } = where(filter);
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.drivers d JOIN app.users u ON u.user_id = d.user_id ${clause}`,
      params,
    );
    return Number((result.rows[0] as { n: string }).n);
  }

  /** Review queue first (SUBMITTED), then the newest change. */
  async list(context: TransactionContext, filter: ShipperListFilter, page: { limit: number; offset: number }): Promise<ShipperListRow[]> {
    const { clause, params } = where(filter);
    params.push(page.limit, page.offset);
    const result = await context.query<RawListRow>(
      `SELECT ${DRIVER_COLUMNS}, u.phone_normalized AS phone, b.verification_state AS bank_state, b.bank_name AS bank_name
         FROM app.drivers d
         JOIN app.users u ON u.user_id = d.user_id
         LEFT JOIN app.driver_bank_accounts b ON b.driver_id = d.driver_id
         ${clause}
        ORDER BY (d.review_state = 'SUBMITTED') DESC, d.updated_at DESC, d.driver_id
        LIMIT $${params.length - 1}::int OFFSET $${params.length}::int`,
      params,
    );
    return result.rows.map(rowOf);
  }

  /**
   * The identity the finance screens show next to a wallet (M04-C): the Shipper code, the name, the status and the phone number, for these driver ids only.
   * The administration masks the name and the phone before it leaves the server; the full values never reach a finance screen.
   */
  async identities(context: TransactionContext, driverIds: readonly string[]): Promise<Map<string, { readonly shipperCode: string; readonly fullName: string; readonly status: string; readonly phone: string }>> {
    const result = await context.query<{ driver_id: string; shipper_code: string; full_name: string; status: string; phone: string }>(
      `SELECT d.driver_id::text AS driver_id, d.shipper_code, d.full_name, d.status, u.phone_normalized AS phone
         FROM app.drivers d JOIN app.users u ON u.user_id = d.user_id WHERE d.driver_id = ANY($1::uuid[])`,
      [[...driverIds]],
    );
    return new Map(result.rows.map((row) => [row.driver_id, { shipperCode: row.shipper_code, fullName: row.full_name, status: row.status, phone: row.phone }]));
  }

  /** The driver ids matching a search pattern (Shipper code, folded name or phone), at most `limit`. */
  async searchIds(context: TransactionContext, pattern: NonNullable<ShipperListFilter['pattern']>, limit: number): Promise<string[]> {
    const { clause, params } = where({ pattern, status: null });
    params.push(limit);
    const result = await context.query<{ driver_id: string }>(
      `SELECT d.driver_id::text AS driver_id FROM app.drivers d JOIN app.users u ON u.user_id = d.user_id ${clause} ORDER BY d.driver_id LIMIT $${params.length}::int`,
      params,
    );
    return result.rows.map((row) => row.driver_id);
  }

  async phoneOf(context: TransactionContext, userId: string): Promise<string | undefined> {
    const result = await context.query<{ phone_normalized: string }>('SELECT phone_normalized FROM app.users WHERE user_id = $1::uuid', [userId]);
    return result.rows[0]?.phone_normalized;
  }
}

function rowOf(raw: RawListRow): ShipperListRow {
  return { driver: toDriver(raw), phone: raw.phone, bankState: raw.bank_state, bankName: raw.bank_name };
}
