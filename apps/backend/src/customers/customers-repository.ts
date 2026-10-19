import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AddressLabel } from './customers-constants';
import { AddressFields } from './customers-validation';

/** The customer record joined with what M01 owns: the account phone and the profile name (read only here). */
export interface CustomerRow {
  readonly customerId: string;
  readonly userId: string;
  /** Normalized E.164 account phone (app.users). The account is never changed by M05. */
  readonly accountPhone: string;
  /** The M01 profile name, or null when none was ever set. */
  readonly fullName: string | null;
  readonly createdAt: string;
}

export interface AddressRow {
  readonly id: string;
  readonly customerId: string;
  readonly label: AddressLabel;
  readonly recipientName: string | null;
  readonly contactPhone: string;
  readonly addressDescription: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly deliveryNote: string | null;
  readonly isDefault: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawAddress {
  id: string;
  customer_id: string;
  label: AddressLabel;
  recipient_name: string | null;
  contact_phone: string;
  address_description: string;
  latitude: number | null;
  longitude: number | null;
  delivery_note: string | null;
  is_default: boolean;
  version: string;
  created_at: string;
  updated_at: string;
}

// Timestamps are formatted by the database (UTC, millisecond precision) so that no driver type parser decides the wire format.
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ADDRESS_COLUMNS = `id::text AS id, customer_id::text AS customer_id, label, recipient_name, contact_phone, address_description,
       latitude, longitude, delivery_note, is_default, version::text AS version,
       to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
       to_char(updated_at AT TIME ZONE 'UTC', ${ISO}) AS updated_at`;

function addressOf(row: RawAddress): AddressRow {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TechnicalError('internal', 'Database returned an unexpected address version');
  }
  return {
    id: row.id,
    customerId: row.customer_id,
    label: row.label,
    recipientName: row.recipient_name,
    contactPhone: row.contact_phone,
    addressDescription: row.address_description,
    latitude: row.latitude,
    longitude: row.longitude,
    deliveryNote: row.delivery_note,
    isDefault: row.is_default,
    version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * SQL for app.customers and app.customer_addresses (M05). Every method receives the caller's TransactionContext; none opens,
 * commits or rolls back a transaction. Nothing here decides WHO may use the address book (CustomersService does) and nothing
 * deletes a row: a deleted address only becomes inactive. Every address statement is scoped by customer_id, so an id of another
 * customer matches nothing.
 */
@Injectable()
export class CustomersRepository {
  /** The customer of a user, or undefined when none exists yet. Pure read; the caller holds the user lock. */
  async findCustomer(context: TransactionContext, userId: string): Promise<CustomerRow | undefined> {
    const result = await context.query<{
      customer_id: string;
      user_id: string;
      account_phone: string;
      full_name: string | null;
      created_at: string;
    }>(
      `SELECT c.id::text AS customer_id, c.user_id::text AS user_id, u.phone_normalized AS account_phone, p.full_name,
              to_char(c.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at
         FROM app.customers c
         JOIN app.users u ON u.user_id = c.user_id
         LEFT JOIN app.customer_profiles p ON p.user_id = c.user_id
        WHERE c.user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return { customerId: row.customer_id, userId: row.user_id, accountPhone: row.account_phone, fullName: row.full_name, createdAt: row.created_at };
  }

  /**
   * Creates the customer of a user unless one exists (user_id is unique): once per account, never a second row. True when this
   * call created it.
   */
  async insertCustomerIfAbsent(context: TransactionContext, customerId: string, userId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.customers (id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT (user_id) DO NOTHING`,
      [customerId, userId],
    );
    return result.rowCount === 1;
  }

  /**
   * The id of the customer of a user, locked FOR UPDATE, or undefined. It is the serialization point of every address write:
   * two devices changing the same book (two defaults at once) wait for each other here. The caller already holds the user and
   * session locks, so this is the last lock of the order idempotency, user, session, customer, address.
   */
  async lockCustomer(context: TransactionContext, userId: string): Promise<string | undefined> {
    const result = await context.query<{ id: string }>(`SELECT id::text AS id FROM app.customers WHERE user_id = $1::uuid FOR UPDATE`, [userId]);
    return result.rows[0]?.id;
  }

  /** An ACTIVE address of the customer of this user, or undefined (another customer's address and a deleted one read the same). Read only. */
  async findActiveAddressOfUser(context: TransactionContext, userId: string, addressId: string): Promise<AddressRow | undefined> {
    const result = await context.query<RawAddress>(
      `SELECT ${ADDRESS_COLUMNS}
         FROM app.customer_addresses
        WHERE id = $2::uuid AND is_active AND customer_id = (SELECT id FROM app.customers WHERE user_id = $1::uuid)`,
      [userId, addressId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : addressOf(row);
  }

  /** Active addresses, default first, then the most recently updated. */
  async listActive(context: TransactionContext, customerId: string): Promise<AddressRow[]> {
    const result = await context.query<RawAddress>(
      `SELECT ${ADDRESS_COLUMNS}
         FROM app.customer_addresses
        WHERE customer_id = $1::uuid AND is_active
        ORDER BY is_default DESC, updated_at DESC, id`,
      [customerId],
    );
    return result.rows.map(addressOf);
  }

  async countActive(context: TransactionContext, customerId: string): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.customer_addresses WHERE customer_id = $1::uuid AND is_active`,
      [customerId],
    );
    return Number(result.rows[0]?.n ?? '0');
  }

  /** One ACTIVE address of this customer FOR UPDATE, or undefined (unknown id, another customer's id and a deleted one are alike). */
  async lockActiveAddress(context: TransactionContext, customerId: string, addressId: string): Promise<AddressRow | undefined> {
    const result = await context.query<RawAddress>(
      `SELECT ${ADDRESS_COLUMNS}
         FROM app.customer_addresses
        WHERE id = $1::uuid AND customer_id = $2::uuid AND is_active
          FOR UPDATE`,
      [addressId, customerId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : addressOf(row);
  }

  async insertAddress(
    context: TransactionContext,
    addressId: string,
    customerId: string,
    fields: AddressFields,
    isDefault: boolean,
  ): Promise<AddressRow> {
    const result = await context.query<RawAddress>(
      `INSERT INTO app.customer_addresses
         (id, customer_id, label, recipient_name, contact_phone, address_description, latitude, longitude, delivery_note, is_default)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::float8, $8::float8, $9, $10::boolean)
       RETURNING ${ADDRESS_COLUMNS}`,
      [
        addressId,
        customerId,
        fields.label,
        fields.recipientName,
        fields.contactPhone,
        fields.addressDescription,
        fields.latitude,
        fields.longitude,
        fields.deliveryNote,
        isDefault,
      ],
    );
    return addressOf(this.#one(result.rows));
  }

  /**
   * Replaces the editable fields of an address and raises its version by exactly 1, only while the stored version is still
   * `expectedVersion`. updated_at never goes below created_at (the table CHECK). Returns the address after the change, or
   * undefined when no row matched (the caller treats it as a version conflict). is_default is not touched here.
   */
  async updateFields(
    context: TransactionContext,
    customerId: string,
    addressId: string,
    fields: AddressFields,
    expectedVersion: number,
  ): Promise<AddressRow | undefined> {
    const result = await context.query<RawAddress>(
      `UPDATE app.customer_addresses
          SET label = $3, recipient_name = $4, contact_phone = $5, address_description = $6,
              latitude = $7::float8, longitude = $8::float8, delivery_note = $9,
              version = version + 1,
              updated_at = GREATEST(created_at, clock_timestamp())
        WHERE id = $1::uuid AND customer_id = $2::uuid AND is_active AND version = $10::bigint
        RETURNING ${ADDRESS_COLUMNS}`,
      [
        addressId,
        customerId,
        fields.label,
        fields.recipientName,
        fields.contactPhone,
        fields.addressDescription,
        fields.latitude,
        fields.longitude,
        fields.deliveryNote,
        expectedVersion,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : addressOf(row);
  }

  /** Takes the default away from the customer's active default address, if there is one. Content version and updated_at stay. */
  async clearDefault(context: TransactionContext, customerId: string): Promise<void> {
    await context.query(`UPDATE app.customer_addresses SET is_default = false WHERE customer_id = $1::uuid AND is_default AND is_active`, [customerId]);
  }

  /**
   * Makes one ACTIVE address the default. The caller cleared the previous default first (the partial unique index would refuse two).
   * Only the flag changes: a default switch is not an edit of the address, so version and updated_at stay (the "most recently
   * updated" rule of a delete is about the content of an address).
   */
  async markDefault(context: TransactionContext, customerId: string, addressId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.customer_addresses SET is_default = true WHERE id = $1::uuid AND customer_id = $2::uuid AND is_active`,
      [addressId, customerId],
    );
    if (result.rowCount !== 1) {
      // Unreachable under the customer and address locks; fail closed rather than report a default that was not set.
      throw new TechnicalError('internal', 'Default address was not set');
    }
  }

  /** Soft delete: inactive and never default. Returns the id when a row changed. */
  async softDelete(context: TransactionContext, customerId: string, addressId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.customer_addresses
          SET is_active = false, is_default = false, version = version + 1, updated_at = GREATEST(created_at, clock_timestamp())
        WHERE id = $1::uuid AND customer_id = $2::uuid AND is_active`,
      [addressId, customerId],
    );
    return result.rowCount === 1;
  }

  /** The active address updated most recently (the next default after the default was deleted), or undefined when none is left. */
  async newestActiveId(context: TransactionContext, customerId: string): Promise<string | undefined> {
    const result = await context.query<{ id: string }>(
      `SELECT id::text AS id FROM app.customer_addresses
        WHERE customer_id = $1::uuid AND is_active
        ORDER BY updated_at DESC, created_at DESC, id
        LIMIT 1`,
      [customerId],
    );
    return result.rows[0]?.id;
  }

  /** Re-reads one active address of this customer (after a default switch changed its flag). */
  async findActiveAddress(context: TransactionContext, customerId: string, addressId: string): Promise<AddressRow | undefined> {
    const result = await context.query<RawAddress>(
      `SELECT ${ADDRESS_COLUMNS} FROM app.customer_addresses WHERE id = $1::uuid AND customer_id = $2::uuid AND is_active`,
      [addressId, customerId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : addressOf(row);
  }

  #one(rows: RawAddress[]): RawAddress {
    const row = rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Database returned no address row');
    }
    return row;
  }
}
