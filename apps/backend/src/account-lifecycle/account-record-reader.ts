import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * Orders, deliveries still being processed (the same list the delivery sweeper treats as "not ended"), M10 order statuses that are not ended.
 * Nothing here is a new state or a new rule: they are the existing end states of the owning modules read the other way round.
 */
const ACTIVE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'PREPARING'] as const;
const ACTIVE_DELIVERY_STATES = ['waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering'] as const;
const OPEN_WITHDRAWAL_STATES = ['PENDING', 'PROCESSING', 'RECONCILIATION'] as const;

/**
 * The tables the account purge (app.purge_app_user) removes together with the account, and the tables that an explicit check below
 * already reads. The catalog scan (`linkedRecords`) skips both so that it only reports what NOBODY else covers.
 */
const PURGED_WITH_ACCOUNT: ReadonlySet<string> = new Set([
  'sessions',
  'user_consents',
  'customer_profiles',
  'user_roles',
  'client_device_bindings',
  'client_device_key_links',
]);
const READ_BY_EXPLICIT_CHECKS: ReadonlySet<string> = new Set([
  'shop_members',
  'drivers',
  'orders',
  'order_chat_messages',
  'deliveries',
  'reviews',
  'complaints',
  'business_finance_requests',
]);
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

interface Membership {
  readonly shops: string;
  readonly drivers: string;
}

/** The two sub-selects that resolve every role of the SAME account ($1 = user id): the shops it belongs to and its driver profile. */
const OF_ACCOUNT: Membership = {
  shops: '(SELECT m.shop_id FROM app.shop_members m WHERE m.user_id = $1::uuid)',
  drivers: '(SELECT d.driver_id FROM app.drivers d WHERE d.user_id = $1::uuid)',
};

/**
 * The read-only SQL behind the account lifecycle checks (M01-LOCK-01). The lifecycle owns this one file instead of asking each module
 * for a port because it needs ONE consistent answer across modules inside the delete / lock transaction; every statement is a plain
 * SELECT and none writes. The account is looked at under EVERY role it holds (customer, shop member, driver): a record counts when
 * the user is the customer / requester / reviewer / submitter, or belongs to the shop, or owns the driver profile.
 *
 * Two kinds of answer, never confused (see AccountActivityRegistry):
 *  - `…Exists`: related data. History, receipts and reconciliation records that must never be lost; they turn a delete into a lock.
 *  - `…Active`: work or money still being processed. It blocks a lock (and the delete that would become one).
 *
 * A failed query throws: it is never read as "nothing found".
 */
@Injectable()
export class AccountRecordReader {
  #linkedColumns: Promise<readonly { table: string; column: string }[]> | undefined;

  async ordersExist(context: TransactionContext, userId: string): Promise<boolean> {
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid)
           OR EXISTS (SELECT 1 FROM app.orders WHERE shop_id IN ${OF_ACCOUNT.shops})
           OR EXISTS (SELECT 1 FROM app.order_chat_messages WHERE sender_user_id = $1::uuid) AS found`,
      userId,
    );
  }

  async ordersActive(context: TransactionContext, userId: string): Promise<number> {
    return this.#count(
      context,
      `SELECT count(*)::int AS n FROM app.orders o
        WHERE o.status = ANY($2::text[]) AND (o.customer_user_id = $1::uuid OR o.shop_id IN ${OF_ACCOUNT.shops})`,
      userId,
      [...ACTIVE_ORDER_STATUSES],
    );
  }

  async deliveriesExist(context: TransactionContext, userId: string): Promise<boolean> {
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.deliveries WHERE requested_by = $1::uuid)
           OR EXISTS (SELECT 1 FROM app.deliveries WHERE shop_id IN ${OF_ACCOUNT.shops})
           OR EXISTS (SELECT 1 FROM app.delivery_assignments WHERE driver_id IN ${OF_ACCOUNT.drivers}) AS found`,
      userId,
    );
  }

  /** Deliveries not ended that the account requested, that belong to one of its shops, or that its driver profile is assigned to. */
  async deliveriesActive(context: TransactionContext, userId: string): Promise<number> {
    return this.#count(
      context,
      `SELECT count(*)::int AS n FROM app.deliveries d
        WHERE d.state = ANY($2::text[])
          AND (d.requested_by = $1::uuid
               OR d.shop_id IN ${OF_ACCOUNT.shops}
               OR EXISTS (SELECT 1 FROM app.delivery_assignments a
                           WHERE a.delivery_id = d.delivery_id AND a.status = 'ACTIVE' AND a.driver_id IN ${OF_ACCOUNT.drivers}))`,
      userId,
      [...ACTIVE_DELIVERY_STATES],
    );
  }

  /** A wallet (and so its ledger, holds, top-ups, withdrawals, adjustments) or a finance request of the shop side. */
  async walletExists(context: TransactionContext, userId: string): Promise<boolean> {
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.driver_wallets WHERE driver_id IN ${OF_ACCOUNT.drivers})
           OR EXISTS (SELECT 1 FROM app.business_finance_requests WHERE owner_user_id = $1::uuid) AS found`,
      userId,
    );
  }

  /**
   * Money still being processed: an ACTIVE hold, a withdrawal that is not paid or cancelled, a top-up request awaiting a decision,
   * a complaint adjustment waiting for finance, a shop finance request not yet decided. A balance alone is NOT work in progress.
   */
  async walletActive(context: TransactionContext, userId: string): Promise<number> {
    return this.#count(
      context,
      `SELECT (
          (SELECT count(*) FROM app.wallet_holds h JOIN app.driver_wallets w ON w.wallet_id = h.wallet_id
            WHERE h.status = 'ACTIVE' AND w.driver_id IN ${OF_ACCOUNT.drivers})
        + (SELECT count(*) FROM app.wallet_withdrawals x WHERE x.state = ANY($2::text[]) AND x.driver_id IN ${OF_ACCOUNT.drivers})
        + (SELECT count(*) FROM app.wallet_topup_requests t WHERE t.state = 'PENDING' AND t.driver_id IN ${OF_ACCOUNT.drivers})
        + (SELECT count(*) FROM app.complaint_adjustments c WHERE c.status = 'PENDING_FINANCE' AND c.driver_id IN ${OF_ACCOUNT.drivers})
        + (SELECT count(*) FROM app.business_finance_requests b WHERE b.state = 'PENDING' AND b.owner_user_id = $1::uuid)
        )::int AS n`,
      userId,
      [...OPEN_WITHDRAWAL_STATES],
    );
  }

  async reviewsExist(context: TransactionContext, userId: string): Promise<boolean> {
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.reviews
                       WHERE reviewer_user_id = $1::uuid OR shop_id IN ${OF_ACCOUNT.shops} OR driver_id IN ${OF_ACCOUNT.drivers}) AS found`,
      userId,
    );
  }

  async complaintsExist(context: TransactionContext, userId: string): Promise<boolean> {
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.complaints
                       WHERE submitter_user_id = $1::uuid OR shop_id IN ${OF_ACCOUNT.shops} OR driver_id IN ${OF_ACCOUNT.drivers}) AS found`,
      userId,
    );
  }

  /**
   * Safety net for records no explicit check knows about (a module added later, a table nobody registered): every single-column foreign
   * key that points at app.users, minus the tables the purge removes and the ones read above. Any hit means "this account has data".
   * The column list comes from the catalog (checked identifiers only) and is read once per process; the rows are read on every call.
   */
  async linkedRecords(context: TransactionContext, userId: string): Promise<boolean> {
    const columns = await this.#linkedColumnList(context);
    if (columns.length === 0) {
      return false;
    }
    const probes = columns.map(({ table, column }) => `EXISTS (SELECT 1 FROM app.${table} WHERE ${column} = $1::uuid)`);
    return this.#flag(context, `SELECT ${probes.join(' OR ')} AS found`, userId);
  }

  /**
   * Serialises this account's work sources against the writers that create new work for it, BEFORE the activity is read (TOCTOU, M01-LOCK-01).
   * Writers lock their own user row first (so the target user lock the caller already holds covers the account acting as customer or
   * driver), place orders against a shop locked FOR SHARE, and change a wallet under its row lock: taking the account's shops and
   * wallet FOR UPDATE here, in a fixed order (shop id, then wallet id), makes a concurrent writer wait until this transaction ends and
   * then see the new account status. Only the lock / delete command calls this; a read never does.
   */
  async lockWorkSources(context: TransactionContext, userId: string): Promise<void> {
    await context.query(
      `SELECT s.shop_id FROM app.shops s WHERE s.shop_id IN ${OF_ACCOUNT.shops} ORDER BY s.shop_id FOR UPDATE`,
      [userId],
    );
    await context.query(
      `SELECT w.wallet_id FROM app.driver_wallets w WHERE w.driver_id IN ${OF_ACCOUNT.drivers} ORDER BY w.wallet_id FOR UPDATE`,
      [userId],
    );
  }

  #linkedColumnList(context: TransactionContext): Promise<readonly { table: string; column: string }[]> {
    if (this.#linkedColumns === undefined) {
      const loading = context
        .query<{ table_name: string; column_name: string }>(
          `SELECT c.relname AS table_name, a.attname AS column_name
             FROM pg_constraint k
             JOIN pg_class c ON c.oid = k.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
            WHERE k.contype = 'f' AND n.nspname = 'app' AND k.confrelid = 'app.users'::regclass AND array_length(k.conkey, 1) = 1
            ORDER BY c.relname, a.attname`,
        )
        .then((result) => {
          const columns: { table: string; column: string }[] = [];
          for (const row of result.rows) {
            if (PURGED_WITH_ACCOUNT.has(row.table_name) || READ_BY_EXPLICIT_CHECKS.has(row.table_name)) {
              continue;
            }
            if (!SAFE_IDENTIFIER.test(row.table_name) || !SAFE_IDENTIFIER.test(row.column_name)) {
              // An identifier we cannot quote safely is a reason to refuse, never to skip the table.
              throw new Error('Unexpected identifier in a foreign key that references users');
            }
            columns.push({ table: row.table_name, column: row.column_name });
          }
          return columns;
        });
      // A failed load must not be cached: the next call asks the catalog again.
      loading.catch(() => {
        this.#linkedColumns = undefined;
      });
      this.#linkedColumns = loading;
    }
    return this.#linkedColumns;
  }

  async #flag(context: TransactionContext, sql: string, userId: string): Promise<boolean> {
    const result = await context.query<{ found: boolean }>(sql, [userId]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Account record check returned no row');
    }
    return row.found === true;
  }

  async #count(context: TransactionContext, sql: string, userId: string, list: readonly string[]): Promise<number> {
    const result = await context.query<{ n: number }>(sql, [userId, list]);
    const row = result.rows[0];
    if (row === undefined || !Number.isInteger(row.n) || row.n < 0) {
      throw new Error('Account activity check returned no count');
    }
    return row.n;
  }
}
