// HTTP client of M01-D-ADMIN-1B (/v1/admin): SYSTEM creates, reissues and revokes ADMIN invitations behind a step-up
// TOTP operation. Routes, bodies and response keys are exactly the ones in docs/tasks/M01-D-ADMIN-WEB-api-inventory.md
// (taken from the backend controller and views); nothing here invents a field or an endpoint.
//
// Every mutation goes through an operation: createOperation -> verifyOperation -> the business POST that carries the
// operation id and the SAME canonical payload. `operationBody` builds that payload once, so the operation and the
// business request cannot drift (the server fingerprints the payload and compares).

import { ApiClient, ApiResult, record, str } from './api.js';

export const PROVISIONING_BASE = '/v1/admin';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'SUPERSEDED' | 'EXPIRED' | 'PHONE_CONFLICT';
export const INVITATION_STATUSES: readonly InvitationStatus[] = ['PENDING', 'ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED', 'PHONE_CONFLICT'];

export type InvitationApp = 'CUSTOMER' | 'SHOP' | 'DRIVER';
export const INVITATION_APPS: readonly InvitationApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];

export interface Permission {
  readonly app: InvitationApp;
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
}

export interface InvitationSummary {
  readonly invitationId: string;
  readonly status: InvitationStatus;
  readonly version: number;
  readonly fullName: string;
  /** The server masks the phone ("09•• ••• 101"); the full number never comes back. */
  readonly phoneMasked: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly terminalAt: string | null;
  readonly successorId: string | null;
  /** status PENDING and past `expiresAt`, decided by the database clock. */
  readonly expired: boolean;
}

export interface InvitationDetail extends InvitationSummary {
  readonly permissions: readonly Permission[];
}

export interface InvitationPage {
  readonly items: readonly InvitationSummary[];
  readonly nextCursor: string | null;
}

export interface IssuedInvitation {
  readonly invitation: InvitationDetail;
  /** `<origin>/activate#t=<token>`: a secret. Kept in memory of the success screen only. */
  readonly activationLink: string;
  /** Set by a reissue: the invitation that was replaced (its link is dead). */
  readonly supersededInvitationId?: string;
}

export type OperationAction = 'CREATE_INVITATION' | 'REISSUE_INVITATION' | 'REVOKE_INVITATION';

export type OperationRequest =
  | {
      readonly action: 'CREATE_INVITATION';
      readonly fullName: string;
      readonly phone: string;
      readonly note: string | null;
      readonly permissions: readonly Permission[];
    }
  | {
      readonly action: 'REISSUE_INVITATION';
      readonly invitationId: string;
      readonly expectedVersion: number;
      readonly reason: string;
      /** null = key absent = "copy the old snapshot". An explicit empty list is never sent. */
      readonly permissions: readonly Permission[] | null;
    }
  | {
      readonly action: 'REVOKE_INVITATION';
      readonly invitationId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    };

export interface OperationCreated {
  readonly operationId: string;
  readonly action: OperationAction;
  readonly expiresAt: string;
}

export interface OperationVerified {
  readonly operationId: string;
  readonly expiresAt: string;
}

export interface OperationView {
  readonly operationId: string;
  readonly action: OperationAction;
  /** The stored status (PENDING, VERIFIED, CONSUMED, INVALIDATED, ...), verbatim. */
  readonly status: string;
  readonly expiresAt: string;
  readonly expired: boolean;
  readonly verifiable: boolean;
  readonly usable: boolean;
  readonly attemptsRemaining: number | null;
  readonly consumedAt: string | null;
  readonly invalidatedReason: string | null;
}

export interface ListQuery {
  readonly status?: InvitationStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

const ACTIONS: readonly string[] = ['CREATE_INVITATION', 'REISSUE_INVITATION', 'REVOKE_INVITATION'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVATION_LINK = /^https?:\/\/[^\s#?]+\/activate#t=[A-Za-z0-9_-]{43}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function permissionsWire(permissions: readonly Permission[]): Record<string, unknown>[] {
  return permissions.map((permission) => ({
    app: permission.app,
    can_view: permission.canView,
    can_review_profile: permission.canReviewProfile,
    can_lock: permission.canLock,
  }));
}

/**
 * The payload of an operation, in the wire shape of the backend parser. The business request of the same action sends
 * exactly this object plus `operation_id` (and, for reissue/revoke, the invitation id travels in the URL instead).
 */
export function operationPayload(request: OperationRequest): Record<string, unknown> {
  switch (request.action) {
    case 'CREATE_INVITATION':
      return {
        full_name: request.fullName,
        phone: request.phone,
        ...(request.note === null ? {} : { note: request.note }),
        permissions: permissionsWire(request.permissions),
      };
    case 'REISSUE_INVITATION':
      return {
        invitation_id: request.invitationId,
        expected_version: request.expectedVersion,
        reason: request.reason,
        ...(request.permissions === null ? {} : { permissions: permissionsWire(request.permissions) }),
      };
    case 'REVOKE_INVITATION':
      return { invitation_id: request.invitationId, expected_version: request.expectedVersion, reason: request.reason };
  }
}

/** The body of the business POST: the operation payload without the id that is already in the URL, plus operation_id. */
export function businessBody(operationId: string, request: OperationRequest): Record<string, unknown> {
  const { invitation_id: _inUrl, ...rest } = operationPayload(request);
  void _inUrl;
  return { operation_id: operationId, ...rest };
}

function permissionOf(value: unknown): Permission | undefined {
  const item = record(value);
  if (item === undefined) {
    return undefined;
  }
  const { app, can_view: canView, can_review_profile: canReviewProfile, can_lock: canLock } = item;
  if (
    typeof app !== 'string' ||
    !(INVITATION_APPS as readonly string[]).includes(app) ||
    typeof canView !== 'boolean' ||
    typeof canReviewProfile !== 'boolean' ||
    typeof canLock !== 'boolean'
  ) {
    return undefined;
  }
  return { app: app as InvitationApp, canView, canReviewProfile, canLock };
}

function permissionsOf(value: unknown): Permission[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: Permission[] = [];
  for (const item of value as unknown[]) {
    const permission = permissionOf(item);
    if (permission === undefined) {
      return undefined;
    }
    result.push(permission);
  }
  return result;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * One invitation as the backend shows it. The create/reissue view has no terminal_at / successor_id / expired (a fresh
 * invitation is none of those), the detail and list views do; missing ones default to their "fresh" value.
 */
function summaryOf(value: unknown): InvitationSummary | undefined {
  const item = record(value);
  if (item === undefined) {
    return undefined;
  }
  const status = item.status;
  const note = nullableString(item.note);
  const terminalAt = nullableString(item.terminal_at);
  const successorRaw = item.successor_id;
  const fullName = item.full_name;
  const phoneMasked = item.phone_masked;
  const createdAt = str(item.created_at);
  const expiresAt = str(item.expires_at);
  if (
    !isUuid(item.invitation_id) ||
    typeof status !== 'string' ||
    !(INVITATION_STATUSES as readonly string[]).includes(status) ||
    typeof item.version !== 'number' ||
    !Number.isSafeInteger(item.version) ||
    item.version < 1 ||
    typeof fullName !== 'string' ||
    typeof phoneMasked !== 'string' ||
    note === undefined ||
    terminalAt === undefined ||
    createdAt === undefined ||
    expiresAt === undefined ||
    (successorRaw !== null && successorRaw !== undefined && !isUuid(successorRaw)) ||
    (item.expired !== undefined && typeof item.expired !== 'boolean')
  ) {
    return undefined;
  }
  return {
    invitationId: item.invitation_id,
    status: status as InvitationStatus,
    version: item.version,
    fullName,
    phoneMasked,
    note,
    createdAt,
    expiresAt,
    terminalAt,
    successorId: typeof successorRaw === 'string' ? successorRaw : null,
    expired: item.expired === true,
  };
}

function detailOf(value: unknown): InvitationDetail | undefined {
  const summary = summaryOf(value);
  const permissions = permissionsOf(record(value)?.permissions);
  return summary === undefined || permissions === undefined ? undefined : { ...summary, permissions };
}

function issuedOf(data: Record<string, unknown>): IssuedInvitation | undefined {
  const invitation = detailOf(data.invitation);
  const link = data.activation_link;
  if (invitation === undefined || typeof link !== 'string' || !ACTIVATION_LINK.test(link)) {
    return undefined;
  }
  const superseded = data.superseded_invitation_id;
  if (superseded !== undefined && !isUuid(superseded)) {
    return undefined;
  }
  return { invitation, activationLink: link, ...(superseded === undefined ? {} : { supersededInvitationId: superseded }) };
}

function actionOf(value: unknown): OperationAction | undefined {
  return typeof value === 'string' && ACTIONS.includes(value) ? (value as OperationAction) : undefined;
}

export class AdminProvisioningApi extends ApiClient {
  /** Step 1 of every mutation: the server fingerprints the payload and opens a 120 s operation. */
  createOperation(csrf: string, request: OperationRequest): Promise<ApiResult<OperationCreated>> {
    return this.call(
      { method: 'POST', path: '/operations', body: { action: request.action, payload: operationPayload(request) }, csrf },
      (data) => {
        const action = actionOf(data.action);
        const expiresAt = str(data.expires_at);
        if (!isUuid(data.operation_id) || action === undefined || data.status !== 'PENDING' || expiresAt === undefined) {
          return undefined;
        }
        return { operationId: data.operation_id, action, expiresAt };
      },
      [201],
    );
  }

  /** Step 2: a fresh TOTP code. Never repeated automatically: a lost answer is read with `readOperation`. */
  verifyOperation(csrf: string, operationId: string, code: string): Promise<ApiResult<OperationVerified>> {
    return this.call({ method: 'POST', path: `/operations/${operationId}/verify`, body: { code }, csrf }, (data) => {
      const expiresAt = str(data.expires_at);
      if (!isUuid(data.operation_id) || data.status !== 'VERIFIED' || expiresAt === undefined) {
        return undefined;
      }
      return { operationId: data.operation_id, expiresAt };
    });
  }

  /** The way back from an unknown outcome: what the server knows about the operation, never written by a GET. */
  readOperation(operationId: string): Promise<ApiResult<OperationView>> {
    return this.call({ method: 'GET', path: `/operations/${operationId}` }, (data) => {
      const action = actionOf(data.action);
      const expiresAt = str(data.expires_at);
      const status = str(data.status);
      const consumedAt = nullableString(data.consumed_at);
      const invalidatedReason = nullableString(data.invalidated_reason);
      const attempts = data.attempts_remaining;
      if (
        !isUuid(data.operation_id) ||
        action === undefined ||
        expiresAt === undefined ||
        status === undefined ||
        typeof data.expired !== 'boolean' ||
        typeof data.verifiable !== 'boolean' ||
        typeof data.usable !== 'boolean' ||
        consumedAt === undefined ||
        invalidatedReason === undefined ||
        (attempts !== null && (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 0))
      ) {
        return undefined;
      }
      return {
        operationId: data.operation_id,
        action,
        status,
        expiresAt,
        expired: data.expired,
        verifiable: data.verifiable,
        usable: data.usable,
        attemptsRemaining: attempts,
        consumedAt,
        invalidatedReason,
      };
    });
  }

  /** `idempotencyKey` is chosen once per logical request by the caller and reused for any deliberate repeat. */
  createInvitation(
    csrf: string,
    idempotencyKey: string,
    operationId: string,
    request: Extract<OperationRequest, { action: 'CREATE_INVITATION' }>,
  ): Promise<ApiResult<IssuedInvitation>> {
    return this.call(
      { method: 'POST', path: '/invitations', body: businessBody(operationId, request), csrf, idempotencyKey },
      issuedOf,
      [200, 201],
    );
  }

  reissueInvitation(
    csrf: string,
    idempotencyKey: string,
    operationId: string,
    request: Extract<OperationRequest, { action: 'REISSUE_INVITATION' }>,
  ): Promise<ApiResult<IssuedInvitation>> {
    return this.call(
      {
        method: 'POST',
        path: `/invitations/${request.invitationId}/reissue`,
        body: businessBody(operationId, request),
        csrf,
        idempotencyKey,
      },
      issuedOf,
      [200, 201],
    );
  }

  revokeInvitation(
    csrf: string,
    idempotencyKey: string,
    operationId: string,
    request: Extract<OperationRequest, { action: 'REVOKE_INVITATION' }>,
  ): Promise<ApiResult<InvitationDetail>> {
    return this.call(
      {
        method: 'POST',
        path: `/invitations/${request.invitationId}/revoke`,
        body: businessBody(operationId, request),
        csrf,
        idempotencyKey,
      },
      (data) => detailOf(data.invitation),
      [200],
    );
  }

  listInvitations(query: ListQuery = {}): Promise<ApiResult<InvitationPage>> {
    const params = new URLSearchParams();
    if (query.status !== undefined) {
      params.set('status', query.status);
    }
    if (query.limit !== undefined) {
      params.set('limit', String(query.limit));
    }
    if (query.cursor !== undefined) {
      params.set('cursor', query.cursor);
    }
    const suffix = params.size === 0 ? '' : `?${params.toString()}`;
    return this.call({ method: 'GET', path: `/invitations${suffix}` }, (data) => {
      if (!Array.isArray(data.items)) {
        return undefined;
      }
      const items: InvitationSummary[] = [];
      for (const raw of data.items as unknown[]) {
        const item = summaryOf(raw);
        if (item === undefined) {
          return undefined;
        }
        items.push(item);
      }
      const nextCursor = data.next_cursor;
      if (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor === '')) {
        return undefined;
      }
      return { items, nextCursor };
    });
  }

  getInvitation(invitationId: string): Promise<ApiResult<InvitationDetail>> {
    return this.call({ method: 'GET', path: `/invitations/${invitationId}` }, (data) => detailOf(data.invitation));
  }
}
