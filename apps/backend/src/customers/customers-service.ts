import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  ADDRESS_MAX_VERSION,
  CUSTOMER_ADDRESS_CREATE_OPERATION_ID,
  CUSTOMER_ADDRESS_DEFAULT_OPERATION_ID,
  CUSTOMER_ADDRESS_DELETE_OPERATION_ID,
  CUSTOMER_ADDRESS_RESOURCE_TYPE,
  CUSTOMER_ADDRESS_SCOPE_TYPE,
  CUSTOMER_ADDRESS_UPDATE_OPERATION_ID,
  CUSTOMER_CREATE_AUDIT_ACTION,
  CUSTOMER_RESOURCE_TYPE,
} from './customers-constants';
import { AddressRow, CustomerRow, CustomersRepository } from './customers-repository';
import { AddressCreateInput, AddressFields, AddressUpdateInput } from './customers-validation';

/** The `data` of GET /v1/customers/me. The account phone is the M01 login number: it only pre-fills a new address. */
export type CustomerView = {
  customer_id: string;
  user_id: string;
  full_name: string | null;
  phone: string;
  created_at: string;
};

export type AddressView = {
  id: string;
  label: string;
  recipient_name: string | null;
  contact_phone: string;
  address_description: string;
  latitude: number | null;
  longitude: number | null;
  delivery_note: string | null;
  is_default: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type AddressListView = { addresses: AddressView[] };
export type AddressDeletedView = { id: string; deleted: true; default_address_id: string | null };

export interface AddressOutcome<T> {
  readonly status: number;
  readonly payload: T;
}

type Key = string | readonly string[] | undefined;

/**
 * Customer record and delivery address book (M05).
 *
 * The caller is the authenticated principal and nothing else: no user id, customer id or role comes from the request. Every
 * authorization that counts runs INSIDE the transaction through ClientSessionAuthority (user row, the CURRENT session row, fresh
 * database clock, client-session and platform gates, ordinary account), then the account must hold the CUSTOMER role. Either app
 * (FOOD or SHIP) may use it; no active context is required and none is changed. A locked, disabled or revoked account fails the
 * authority before anything is read or written.
 *
 * Lock order of every write, after the executor's own advisory and record locks: user row, session row, customer row, the one
 * address row. The customer row serializes the whole book of a customer, so two devices changing the default at once wait for
 * each other and the database keeps exactly one default (the partial unique index is the last line of defence).
 *
 * The customer row is created lazily, once per user (user_id is unique), by the first read of the profile or the first address.
 * Writes go through the idempotency executor: a replay of a committed change does not apply it again, it returns the stored
 * result after re-checking the session and the role under the same locks.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly customers: CustomersRepository,
    private readonly audit: AuditWriter,
  ) {}

  // ------------------------------------------------------------------------------------------------------------- reads

  /**
   * GET /v1/customers/me. A read transaction first (user FOR SHARE, session FOR SHARE, role, customer). Only when the customer
   * row does not exist yet a second, writing transaction creates it (once; a concurrent creation resolves through user_id UNIQUE).
   */
  async readCustomer(principal: AuthPrincipal, requestId: string): Promise<CustomerView> {
    const existing = await this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      await this.#requireCustomerRole(context, actor.userId);
      return this.customers.findCustomer(context, actor.userId);
    });
    if (existing !== undefined) {
      return customerView(existing);
    }
    const created = await this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'update');
      await this.#requireCustomerRole(context, actor.userId);
      await this.#ensureCustomer(context, actor, requestId);
      const row = await this.customers.findCustomer(context, actor.userId);
      if (row === undefined) {
        // Unreachable: the row was just inserted or already existed under the user lock.
        throw new TechnicalError('internal', 'Customer row is missing after creation');
      }
      return row;
    });
    return customerView(created);
  }

  /** GET /v1/customers/me/addresses: the ACTIVE addresses, default first. A customer with no row yet has an empty book; nothing is created. */
  async listAddresses(principal: AuthPrincipal): Promise<AddressListView> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      await this.#requireCustomerRole(context, actor.userId);
      const customer = await this.customers.findCustomer(context, actor.userId);
      if (customer === undefined) {
        return { addresses: [] };
      }
      const rows = await this.customers.listActive(context, customer.customerId);
      return { addresses: rows.map(addressView) };
    });
  }

  /**
   * The ACTIVE address of this account for checkout (M10), read inside the caller's transaction (the caller holds the user and session locks). The Order
   * keeps its own copy: a later change or deletion of the address does not touch it. Undefined for a missing, deleted or foreign address.
   */
  findAddressForOrder(context: TransactionContext, userId: string, addressId: string): Promise<AddressRow | undefined> {
    return this.customers.findActiveAddressOfUser(context, userId, addressId);
  }

  // ------------------------------------------------------------------------------------------------------------ writes

  /** POST /v1/customers/me/addresses. The first address is the default; later ones only when asked. */
  async createAddress(
    principal: AuthPrincipal,
    input: AddressCreateInput,
    idempotencyKey: Key,
    requestId: string,
  ): Promise<AddressOutcome<AddressView>> {
    const outcome = await this.executor.execute(
      {
        scopeType: CUSTOMER_ADDRESS_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: CUSTOMER_ADDRESS_CREATE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: {
          label: input.label,
          recipient_name: input.recipientName,
          contact_phone: input.contactPhone,
          address_description: input.addressDescription,
          latitude: input.latitude,
          longitude: input.longitude,
          delivery_note: input.deliveryNote,
          is_default: input.makeDefault,
        },
        replay: this.#replayPolicy(principal),
      },
      async (context) => {
        const actor = await this.authority.lock(context, principal, 'update');
        await this.#requireCustomerRole(context, actor.userId);
        const customerId = await this.#ensureCustomer(context, actor, requestId);
        const isFirst = (await this.customers.countActive(context, customerId)) === 0;
        const makeDefault = isFirst || input.makeDefault;
        if (makeDefault && !isFirst) {
          await this.customers.clearDefault(context, customerId);
        }
        const created = await this.customers.insertAddress(context, randomUUID(), customerId, input, makeDefault);
        await this.#audit(context, requestId, actor.userId, CUSTOMER_ADDRESS_CREATE_OPERATION_ID, created, { customer_id: customerId, is_default: created.isDefault });
        return { status: 201, replayGuard: { user_id: actor.userId }, payload: addressView(created) };
      },
    );
    return { status: outcome.status, payload: outcome.payload as AddressView };
  }

  /**
   * PATCH /v1/customers/me/addresses/:id. A partial change at an exact version. A stale version is VERSION_CONFLICT. The default
   * switch (is_default: true) is part of the same commit.
   */
  async updateAddress(
    principal: AuthPrincipal,
    addressId: string,
    input: AddressUpdateInput,
    idempotencyKey: Key,
    requestId: string,
  ): Promise<AddressOutcome<AddressView>> {
    const outcome = await this.executor.execute(
      {
        scopeType: CUSTOMER_ADDRESS_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: CUSTOMER_ADDRESS_UPDATE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: logicalPatch(addressId, input),
        replay: this.#replayPolicy(principal),
      },
      async (context) => {
        const actor = await this.authority.lock(context, principal, 'update');
        await this.#requireCustomerRole(context, actor.userId);
        const customerId = await this.#lockCustomerId(context, actor.userId);
        const current = await this.customers.lockActiveAddress(context, customerId, addressId);
        if (current === undefined) {
          throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
        }
        // A wrong version, and a version that cannot be raised within the schema bound, are the same conflict.
        if (current.version !== input.expectedVersion || current.version >= ADDRESS_MAX_VERSION) {
          throw new AppError('VERSION_CONFLICT');
        }
        const patch = input.patch;
        const merged: AddressFields = {
          label: patch.label ?? current.label,
          recipientName: patch.recipientName !== undefined ? patch.recipientName : current.recipientName,
          contactPhone: patch.contactPhone ?? current.contactPhone,
          addressDescription: patch.addressDescription ?? current.addressDescription,
          latitude: patch.position !== undefined ? (patch.position === null ? null : patch.position.latitude) : current.latitude,
          longitude: patch.position !== undefined ? (patch.position === null ? null : patch.position.longitude) : current.longitude,
          deliveryNote: patch.deliveryNote !== undefined ? patch.deliveryNote : current.deliveryNote,
        };
        const changesContent = Object.keys(patch).some((key) => key !== 'makeDefault');
        let updated: AddressRow = current;
        if (changesContent) {
          const changed = await this.customers.updateFields(context, customerId, addressId, merged, current.version);
          if (changed === undefined) {
            // Unreachable under the address lock; fail closed rather than report a change that did not happen.
            throw new AppError('VERSION_CONFLICT');
          }
          updated = changed;
        }
        if (patch.makeDefault === true && !current.isDefault) {
          await this.customers.clearDefault(context, customerId);
          await this.customers.markDefault(context, customerId, addressId);
          updated = await this.#reread(context, customerId, addressId);
        }
        await this.#audit(context, requestId, actor.userId, CUSTOMER_ADDRESS_UPDATE_OPERATION_ID, updated, {
          customer_id: customerId,
          from_version: current.version,
          to_version: updated.version,
          is_default: updated.isDefault,
        });
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: addressView(updated) };
      },
    );
    return { status: outcome.status, payload: outcome.payload as AddressView };
  }

  /**
   * DELETE /v1/customers/me/addresses/:id. A soft delete. When the default was deleted, the active address updated most recently
   * becomes the default; with none left there is no default. Orders already placed keep their own snapshot (not touched here).
   */
  async deleteAddress(principal: AuthPrincipal, addressId: string, idempotencyKey: Key, requestId: string): Promise<AddressOutcome<AddressDeletedView>> {
    const outcome = await this.executor.execute(
      {
        scopeType: CUSTOMER_ADDRESS_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: CUSTOMER_ADDRESS_DELETE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { address_id: addressId },
        replay: this.#replayPolicy(principal),
      },
      async (context) => {
        const actor = await this.authority.lock(context, principal, 'update');
        await this.#requireCustomerRole(context, actor.userId);
        const customerId = await this.#lockCustomerId(context, actor.userId);
        const current = await this.customers.lockActiveAddress(context, customerId, addressId);
        if (current === undefined) {
          throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
        }
        if (!(await this.customers.softDelete(context, customerId, addressId))) {
          // Unreachable under the address lock.
          throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
        }
        let defaultId: string | null = null;
        if (current.isDefault) {
          const next = await this.customers.newestActiveId(context, customerId);
          if (next !== undefined) {
            await this.customers.markDefault(context, customerId, next);
            defaultId = next;
          }
        }
        await this.audit.append(context, {
          requestId,
          actorType: 'USER',
          actorId: actor.userId,
          action: CUSTOMER_ADDRESS_DELETE_OPERATION_ID,
          resourceType: CUSTOMER_ADDRESS_RESOURCE_TYPE,
          resourceId: addressId,
          resourceVersion: current.version + 1,
          outcome: 'SUCCESS',
          metadata: { customer_id: customerId, was_default: current.isDefault, new_default_id: defaultId },
        });
        const payload: AddressDeletedView = { id: addressId, deleted: true, default_address_id: defaultId };
        return { status: 200, replayGuard: { user_id: actor.userId }, payload };
      },
    );
    return { status: outcome.status, payload: outcome.payload as AddressDeletedView };
  }

  /** PUT /v1/customers/me/addresses/:id/default. Atomic: the old default is cleared and the new one set in one transaction. */
  async setDefaultAddress(principal: AuthPrincipal, addressId: string, idempotencyKey: Key, requestId: string): Promise<AddressOutcome<AddressView>> {
    const outcome = await this.executor.execute(
      {
        scopeType: CUSTOMER_ADDRESS_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: CUSTOMER_ADDRESS_DEFAULT_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { address_id: addressId },
        replay: this.#replayPolicy(principal),
      },
      async (context) => {
        const actor = await this.authority.lock(context, principal, 'update');
        await this.#requireCustomerRole(context, actor.userId);
        const customerId = await this.#lockCustomerId(context, actor.userId);
        const current = await this.customers.lockActiveAddress(context, customerId, addressId);
        if (current === undefined) {
          throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
        }
        let result = current;
        if (!current.isDefault) {
          await this.customers.clearDefault(context, customerId);
          await this.customers.markDefault(context, customerId, addressId);
          result = await this.#reread(context, customerId, addressId);
        }
        await this.#audit(context, requestId, actor.userId, CUSTOMER_ADDRESS_DEFAULT_OPERATION_ID, result, {
          customer_id: customerId,
          changed: !current.isDefault,
        });
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: addressView(result) };
      },
    );
    return { status: outcome.status, payload: outcome.payload as AddressView };
  }

  // ----------------------------------------------------------------------------------------------------------- helpers

  #replayPolicy(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        const { user_id: userId } = guard;
        if (!isCanonicalUuid(userId) || userId !== principal.userId) {
          // A guard we did not write, or one that is not this caller's: fail closed, nothing is decrypted.
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        // Same locks and order as the first execution, session and role only. Read-only.
        const actor = await this.authority.lock(context, principal, 'update');
        await this.#requireCustomerRole(context, actor.userId);
        return true;
      },
    };
  }

  async #requireCustomerRole(context: TransactionContext, userId: string): Promise<void> {
    if (!(await this.users.hasRole(context, userId, CUSTOMER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }

  /** Creates the customer once if absent, then locks it. Returns its id. The caller already holds the user and session locks. */
  async #ensureCustomer(context: TransactionContext, actor: ClientActor, requestId: string): Promise<string> {
    const created = await this.customers.insertCustomerIfAbsent(context, randomUUID(), actor.userId);
    const customerId = await this.customers.lockCustomer(context, actor.userId);
    if (customerId === undefined) {
      throw new TechnicalError('internal', 'Customer row is missing after creation');
    }
    if (created) {
      await this.audit.append(context, {
        requestId,
        actorType: 'USER',
        actorId: actor.userId,
        action: CUSTOMER_CREATE_AUDIT_ACTION,
        resourceType: CUSTOMER_RESOURCE_TYPE,
        resourceId: customerId,
        outcome: 'SUCCESS',
        metadata: { customer_id: customerId, user_id: actor.userId },
      });
    }
    return customerId;
  }

  /** Locks the customer of a write that needs an existing book. No customer row means no address of this caller exists. */
  async #lockCustomerId(context: TransactionContext, userId: string): Promise<string> {
    const customerId = await this.customers.lockCustomer(context, userId);
    if (customerId === undefined) {
      throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
    }
    return customerId;
  }

  async #reread(context: TransactionContext, customerId: string, addressId: string): Promise<AddressRow> {
    const row = await this.customers.findActiveAddress(context, customerId, addressId);
    if (row === undefined) {
      throw new TechnicalError('internal', 'Address row is missing after a default change');
    }
    return row;
  }

  async #audit(
    context: TransactionContext,
    requestId: string,
    userId: string,
    action: string,
    address: AddressRow,
    metadata: JsonObject,
  ): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action,
      resourceType: CUSTOMER_ADDRESS_RESOURCE_TYPE,
      resourceId: address.id,
      resourceVersion: address.version,
      outcome: 'SUCCESS',
      metadata,
    });
  }
}

function customerView(row: CustomerRow): CustomerView {
  return { customer_id: row.customerId, user_id: row.userId, full_name: row.fullName, phone: row.accountPhone, created_at: row.createdAt };
}

function addressView(row: AddressRow): AddressView {
  return {
    id: row.id,
    label: row.label,
    recipient_name: row.recipientName,
    contact_phone: row.contactPhone,
    address_description: row.addressDescription,
    latitude: row.latitude,
    longitude: row.longitude,
    delivery_note: row.deliveryNote,
    is_default: row.isDefault,
    version: row.version,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The normalized logical request of a PATCH: only the keys that were sent, so "sent" and "not sent" are different requests. */
function logicalPatch(addressId: string, input: AddressUpdateInput): JsonObject {
  const patch = input.patch;
  const logical: JsonObject = { address_id: addressId, expected_version: input.expectedVersion };
  if (patch.label !== undefined) {
    logical.label = patch.label;
  }
  if (patch.recipientName !== undefined) {
    logical.recipient_name = patch.recipientName;
  }
  if (patch.contactPhone !== undefined) {
    logical.contact_phone = patch.contactPhone;
  }
  if (patch.addressDescription !== undefined) {
    logical.address_description = patch.addressDescription;
  }
  if (patch.position !== undefined) {
    logical.latitude = patch.position === null ? null : patch.position.latitude;
    logical.longitude = patch.position === null ? null : patch.position.longitude;
  }
  if (patch.deliveryNote !== undefined) {
    logical.delivery_note = patch.deliveryNote;
  }
  if (patch.makeDefault !== undefined) {
    logical.is_default = true;
  }
  return logical;
}
