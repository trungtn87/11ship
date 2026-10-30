import { Injectable } from '@nestjs/common';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletAccountActivityReader } from '../wallet/wallet-account-activity-reader';

/**
 * Orders and deliveries still being processed (the same list the delivery sweeper treats as "not ended"). Nothing here is a new state or a
 * new rule: they are the existing end states of the owning modules read the other way round.
 */
const ACTIVE_ORDER_STATUSES = ['PENDING_CONFIRMATION', 'PREPARING'] as const;
const ACTIVE_DELIVERY_STATES = ['waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering'] as const;

/**
 * The tables the account purge (app.purge_app_user) removes together with the account, and the tables that an explicit check below
 * (or a module port) already reads. The catalog scan (`linkedRecords`) skips both so that it only reports what NOBODY else covers.
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

/** Who the account is, under every role it holds: its shops and its driver profile, resolved through their owners' ports. */
interface Who {
  readonly shopIds: string[];
  readonly driverId: string | undefined;
}

/**
 * The read-only SQL behind the account lifecycle checks (M01-LOCK-01). The lifecycle needs ONE consistent answer across modules inside the
 * delete / lock transaction. The Shop, Driver and Wallet packages own their tables: the shop and driver side of the account is resolved
 * through their ports (ShopEligibilityReader, DriverEligibilityReader, WalletAccountActivityReader) and the rest (orders, deliveries,
 * reviews, complaints, chat, shop finance requests) is plain SELECT here. The account is looked at under EVERY role it holds (customer,
 * shop member, driver): a record counts when the user is the customer / requester / reviewer / submitter, or belongs to the shop, or
 * owns the driver profile.
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

  constructor(
    private readonly shops: ShopEligibilityReader,
    private readonly shopRows: ShopRepository,
    private readonly drivers: DriverEligibilityReader,
    private readonly wallets: WalletAccountActivityReader,
  ) {}

  async ordersExist(context: TransactionContext, userId: string): Promise<boolean> {
    const who = await this.#who(context, userId);
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid OR shop_id = ANY($2::uuid[]))
           OR EXISTS (SELECT 1 FROM app.order_chat_messages WHERE sender_user_id = $1::uuid) AS found`,
      [userId, who.shopIds],
    );
  }

  async ordersActive(context: TransactionContext, userId: string): Promise<number> {
    const who = await this.#who(context, userId);
    return this.#count(
      context,
      `SELECT count(*)::int AS n FROM app.orders o
        WHERE o.status = ANY($3::text[]) AND (o.customer_user_id = $1::uuid OR o.shop_id = ANY($2::uuid[]))`,
      [userId, who.shopIds, [...ACTIVE_ORDER_STATUSES]],
    );
  }

  async deliveriesExist(context: TransactionContext, userId: string): Promise<boolean> {
    const who = await this.#who(context, userId);
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.deliveries WHERE requested_by = $1::uuid OR shop_id = ANY($2::uuid[]))
           OR EXISTS (SELECT 1 FROM app.delivery_assignments WHERE driver_id = $3::uuid) AS found`,
      [userId, who.shopIds, who.driverId ?? null],
    );
  }

  /** Deliveries not ended that the account requested, that belong to one of its shops, or that its driver profile is assigned to. */
  async deliveriesActive(context: TransactionContext, userId: string): Promise<number> {
    const who = await this.#who(context, userId);
    return this.#count(
      context,
      `SELECT count(*)::int AS n FROM app.deliveries d
        WHERE d.state = ANY($4::text[])
          AND (d.requested_by = $1::uuid
               OR d.shop_id = ANY($2::uuid[])
               OR EXISTS (SELECT 1 FROM app.delivery_assignments a
                           WHERE a.delivery_id = d.delivery_id AND a.status = 'ACTIVE' AND a.driver_id = $3::uuid))`,
      [userId, who.shopIds, who.driverId ?? null, [...ACTIVE_DELIVERY_STATES]],
    );
  }

  /** A wallet (and so its ledger, holds, top-ups, withdrawals, adjustments) or a finance request of the shop side. */
  async walletExists(context: TransactionContext, userId: string): Promise<boolean> {
    const who = await this.#who(context, userId);
    if (await this.wallets.hasWallet(context, who.driverId)) {
      return true;
    }
    return this.#flag(context, 'SELECT EXISTS (SELECT 1 FROM app.business_finance_requests WHERE owner_user_id = $1::uuid) AS found', [userId]);
  }

  /**
   * Money still being processed: an ACTIVE hold, a withdrawal that is not paid or cancelled, a top-up request awaiting a decision (the
   * wallet answers), a complaint adjustment waiting for finance, a shop finance request not yet decided. A balance alone is NOT work.
   */
  async walletActive(context: TransactionContext, userId: string): Promise<number> {
    const who = await this.#who(context, userId);
    const own = await this.wallets.moneyInProgress(context, who.driverId);
    const others = await this.#count(
      context,
      `SELECT (
          (SELECT count(*) FROM app.complaint_adjustments c WHERE c.status = 'PENDING_FINANCE' AND c.driver_id = $2::uuid)
        + (SELECT count(*) FROM app.business_finance_requests b WHERE b.state = 'PENDING' AND b.owner_user_id = $1::uuid)
        )::int AS n`,
      [userId, who.driverId ?? null],
    );
    return own + others;
  }

  async reviewsExist(context: TransactionContext, userId: string): Promise<boolean> {
    const who = await this.#who(context, userId);
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.reviews WHERE reviewer_user_id = $1::uuid OR shop_id = ANY($2::uuid[]) OR driver_id = $3::uuid) AS found`,
      [userId, who.shopIds, who.driverId ?? null],
    );
  }

  async complaintsExist(context: TransactionContext, userId: string): Promise<boolean> {
    const who = await this.#who(context, userId);
    return this.#flag(
      context,
      `SELECT EXISTS (SELECT 1 FROM app.complaints WHERE submitter_user_id = $1::uuid OR shop_id = ANY($2::uuid[]) OR driver_id = $3::uuid) AS found`,
      [userId, who.shopIds, who.driverId ?? null],
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
    return this.#flag(context, `SELECT ${probes.join(' OR ')} AS found`, [userId]);
  }

  /**
   * Serialises this account's work sources against the writers that create new work for it, BEFORE the activity is read (TOCTOU, M01-LOCK-01).
   * Writers lock their own user row first (so the target user lock the caller already holds covers the account acting as customer or
   * driver), place orders against a shop locked FOR SHARE, and change a wallet under its row lock: taking the account's shops and
   * wallet FOR UPDATE here, in a fixed order (shop id, then wallet), makes a concurrent writer wait until this transaction ends and
   * then see the new account status. Only the lock / delete command calls this; a read never does.
   */
  async lockWorkSources(context: TransactionContext, userId: string): Promise<void> {
    const who = await this.#who(context, userId);
    // Id order (memberShopIds sorts), the same one every owner path of the Shop module takes.
    for (const shopId of who.shopIds) {
      await this.shopRows.lockShopForUpdate(context, shopId);
    }
    await this.wallets.lockWallet(context, who.driverId);
  }

  async #who(context: TransactionContext, userId: string): Promise<Who> {
    return { shopIds: await this.shops.memberShopIds(context, userId), driverId: await this.drivers.driverIdOf(context, userId) };
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

  async #flag(context: TransactionContext, sql: string, params: readonly unknown[]): Promise<boolean> {
    const result = await context.query<{ found: boolean }>(sql, [...params]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Account record check returned no row');
    }
    return row.found === true;
  }

  async #count(context: TransactionContext, sql: string, params: readonly unknown[]): Promise<number> {
    const result = await context.query<{ n: number }>(sql, [...params]);
    const row = result.rows[0];
    if (row === undefined || !Number.isInteger(row.n) || row.n < 0) {
      throw new Error('Account activity check returned no count');
    }
    return row.n;
  }
}
