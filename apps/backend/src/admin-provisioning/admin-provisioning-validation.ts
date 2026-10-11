import { isTotpCodeShape } from '../admin-auth/totp';
import { normalizeVietnamPhone } from '../auth/phone';
import { AppError } from '../common/app-errors';
import { InvitationApp, InvitationPermission, InvitationStatus } from '../admin-invitations/admin-invitation-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  FULL_NAME_MAX_CODE_POINTS,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  NOTE_MAX_LENGTH,
  OperationAction,
  REASON_MAX_LENGTH,
} from './admin-provisioning-constants';

// Strict parsers of M01-D-ADMIN-1B (contract section 6.1). ONE parser per payload is shared by create-operation and the
// business route, so both compute the same canonical payload and therefore the same fingerprint. Anything malformed,
// any unknown key and any key the client may not send (role, account_origin, user_id, status, token, ...) is the fixed
// 400 ADMIN_INPUT_INVALID; nothing the client sent is ever echoed.

export interface CreatePayload {
  readonly fullName: string;
  /** +84XXXXXXXXX */
  readonly phone: string;
  readonly note: string | null;
  /** Sorted by app. */
  readonly permissions: readonly InvitationPermission[];
}

export interface ReissuePayload {
  readonly invitationId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  /** null = "copy the snapshot of the old invitation" (the key was absent); otherwise a new snapshot, sorted by app. */
  readonly permissions: readonly InvitationPermission[] | null;
}

export interface RevokePayload {
  readonly invitationId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

export type OperationRequest =
  | { readonly action: 'CREATE_INVITATION'; readonly payload: CreatePayload }
  | { readonly action: 'REISSUE_INVITATION'; readonly payload: ReissuePayload }
  | { readonly action: 'REVOKE_INVITATION'; readonly payload: RevokePayload };

export interface ListQuery {
  readonly status: InvitationStatus | null;
  readonly limit: number;
  readonly cursor: ListCursor | null;
}

export interface ListCursor {
  readonly createdAtMs: number;
  readonly invitationId: string;
}

const APPS: readonly InvitationApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];
const STATUSES: readonly InvitationStatus[] = ['PENDING', 'ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED', 'PHONE_CONFLICT'];
const PERMISSION_KEYS = ['app', 'can_lock', 'can_review_profile', 'can_view'];

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  return value as Record<string, unknown>;
}

/** Exactly the required keys, plus only the listed optional ones. */
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      invalid();
    }
  }
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalid();
    }
  }
}

function codePoints(text: string): number {
  return [...text].length;
}

export function parseUuid(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid();
  }
  return value;
}

function parseFullName(value: unknown): string {
  if (typeof value !== 'string') {
    invalid();
  }
  const trimmed = value.trim();
  const length = codePoints(trimmed);
  if (length < 1 || length > FULL_NAME_MAX_CODE_POINTS) {
    invalid();
  }
  return trimmed;
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || codePoints(value) > NOTE_MAX_LENGTH) {
    invalid();
  }
  return value.length === 0 ? null : value;
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string') {
    invalid();
  }
  const trimmed = value.trim();
  const length = codePoints(trimmed);
  if (length < 1 || length > REASON_MAX_LENGTH) {
    invalid();
  }
  return trimmed;
}

function parsePhone(value: unknown): string {
  const normalized = normalizeVietnamPhone(value);
  if (normalized === undefined || !/^\+84[0-9]{9}$/.test(normalized)) {
    invalid();
  }
  return normalized;
}

/** 1..3 distinct apps, all four keys, booleans; at least one VIEW; REVIEW/LOCK need VIEW; CUSTOMER has no REVIEW. */
export function parsePermissions(value: unknown): readonly InvitationPermission[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > APPS.length) {
    invalid();
  }
  const seen = new Set<string>();
  const permissions: InvitationPermission[] = [];
  for (const item of value as unknown[]) {
    const entry = plainObject(item);
    exactKeys(entry, PERMISSION_KEYS);
    const { app, can_view: canView, can_review_profile: canReviewProfile, can_lock: canLock } = entry;
    if (typeof app !== 'string' || !(APPS as readonly string[]).includes(app) || seen.has(app)) {
      invalid();
    }
    if (typeof canView !== 'boolean' || typeof canReviewProfile !== 'boolean' || typeof canLock !== 'boolean') {
      invalid();
    }
    if ((canReviewProfile || canLock) && !canView) {
      invalid();
    }
    if (app === 'CUSTOMER' && canReviewProfile) {
      invalid();
    }
    seen.add(app);
    permissions.push({ app: app as InvitationApp, canView, canReviewProfile, canLock });
  }
  if (!permissions.some((permission) => permission.canView)) {
    invalid();
  }
  return Object.freeze(permissions.sort((a, b) => (a.app < b.app ? -1 : a.app > b.app ? 1 : 0)));
}

function createPayloadOf(source: Record<string, unknown>): CreatePayload {
  return {
    fullName: parseFullName(source.full_name),
    phone: parsePhone(source.phone),
    note: parseNote(source.note),
    permissions: parsePermissions(source.permissions),
  };
}

function reissuePayloadOf(invitationId: unknown, source: Record<string, unknown>): ReissuePayload {
  return {
    invitationId: parseUuid(invitationId),
    expectedVersion: parseVersion(source.expected_version),
    reason: parseReason(source.reason),
    // Absent key = copy. An explicit null or [] is NOT "copy": parsePermissions refuses it.
    permissions: Object.hasOwn(source, 'permissions') ? parsePermissions(source.permissions) : null,
  };
}

function revokePayloadOf(invitationId: unknown, source: Record<string, unknown>): RevokePayload {
  return {
    invitationId: parseUuid(invitationId),
    expectedVersion: parseVersion(source.expected_version),
    reason: parseReason(source.reason),
  };
}

/** POST /admin/operations: { action, payload }. */
export function parseOperationBody(body: unknown): OperationRequest {
  const root = plainObject(body);
  exactKeys(root, ['action', 'payload']);
  const payload = plainObject(root.payload);
  switch (root.action) {
    case 'CREATE_INVITATION':
      exactKeys(payload, ['full_name', 'phone', 'permissions'], ['note']);
      return { action: 'CREATE_INVITATION', payload: createPayloadOf(payload) };
    case 'REISSUE_INVITATION':
      exactKeys(payload, ['invitation_id', 'expected_version', 'reason'], ['permissions']);
      return { action: 'REISSUE_INVITATION', payload: reissuePayloadOf(payload.invitation_id, payload) };
    case 'REVOKE_INVITATION':
      exactKeys(payload, ['invitation_id', 'expected_version', 'reason']);
      return { action: 'REVOKE_INVITATION', payload: revokePayloadOf(payload.invitation_id, payload) };
    default:
      return invalid();
  }
}

/** POST /admin/operations/:id/verify: exactly { "code": "<6 ASCII digits>" }. */
export function parseVerifyBody(body: unknown): string {
  const root = plainObject(body);
  exactKeys(root, ['code']);
  if (!isTotpCodeShape(root.code)) {
    invalid();
  }
  return root.code;
}

/** POST /admin/invitations. */
export function parseCreateInvitationBody(body: unknown): { operationId: string; payload: CreatePayload } {
  const root = plainObject(body);
  exactKeys(root, ['operation_id', 'full_name', 'phone', 'permissions'], ['note']);
  return { operationId: parseUuid(root.operation_id), payload: createPayloadOf(root) };
}

/** POST /admin/invitations/:id/reissue. Name, note and phone always come from the old invitation (Q1). */
export function parseReissueBody(invitationId: unknown, body: unknown): { operationId: string; payload: ReissuePayload } {
  const root = plainObject(body);
  exactKeys(root, ['operation_id', 'expected_version', 'reason'], ['permissions']);
  return { operationId: parseUuid(root.operation_id), payload: reissuePayloadOf(invitationId, root) };
}

/** POST /admin/invitations/:id/revoke. */
export function parseRevokeBody(invitationId: unknown, body: unknown): { operationId: string; payload: RevokePayload } {
  const root = plainObject(body);
  exactKeys(root, ['operation_id', 'expected_version', 'reason']);
  return { operationId: parseUuid(root.operation_id), payload: revokePayloadOf(invitationId, root) };
}

function permissionsJson(permissions: readonly InvitationPermission[]): JsonObject[] {
  return permissions.map((permission) => ({
    app: permission.app,
    can_view: permission.canView,
    can_review_profile: permission.canReviewProfile,
    can_lock: permission.canLock,
  }));
}

/**
 * The canonical payload of contract section 6.3 (snake_case, permissions sorted). It is the fingerprint input of the
 * operation and part of the idempotency logical request. For a reissue `permissions` is ALWAYS present: null means
 * "copy", so "absent" and "explicitly equal to the old list" fingerprint differently.
 */
export function canonicalPayload(request: OperationRequest): JsonObject {
  switch (request.action) {
    case 'CREATE_INVITATION':
      return {
        full_name: request.payload.fullName,
        phone: request.payload.phone,
        note: request.payload.note,
        permissions: permissionsJson(request.payload.permissions),
      };
    case 'REISSUE_INVITATION':
      return {
        invitation_id: request.payload.invitationId,
        expected_version: request.payload.expectedVersion,
        reason: request.payload.reason,
        permissions: request.payload.permissions === null ? null : permissionsJson(request.payload.permissions),
      };
    case 'REVOKE_INVITATION':
      return {
        invitation_id: request.payload.invitationId,
        expected_version: request.payload.expectedVersion,
        reason: request.payload.reason,
      };
  }
}

export function targetOf(request: OperationRequest): { targetId: string | null; expectedVersion: number | null } {
  return request.action === 'CREATE_INVITATION'
    ? { targetId: null, expectedVersion: null }
    : { targetId: request.payload.invitationId, expectedVersion: request.payload.expectedVersion };
}

export function isOperationAction(value: unknown): value is OperationAction {
  return value === 'CREATE_INVITATION' || value === 'REISSUE_INVITATION' || value === 'REVOKE_INVITATION';
}

function singleQueryValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    // A repeated parameter (an array) or a nested object is ambiguous.
    invalid();
  }
  return value;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAtMs, cursor.invitationId]), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): ListCursor {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(raw)) {
    invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    invalid();
  }
  const [createdAtMs, invitationId] = parsed as unknown[];
  if (typeof createdAtMs !== 'number' || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0 || !isCanonicalUuid(invitationId)) {
    invalid();
  }
  const cursor = { createdAtMs, invitationId };
  // Opaque but canonical: only what this server issued round-trips.
  if (encodeCursor(cursor) !== raw) {
    invalid();
  }
  return cursor;
}

/** GET /admin/invitations?status=&limit=&cursor= */
export function parseListQuery(query: unknown): ListQuery {
  const root = query === undefined ? {} : plainObject(query);
  exactKeys(root, [], ['status', 'limit', 'cursor']);
  const status = singleQueryValue(root.status);
  const limit = singleQueryValue(root.limit);
  const cursor = singleQueryValue(root.cursor);
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
    invalid();
  }
  let parsedLimit = LIST_DEFAULT_LIMIT;
  if (limit !== undefined) {
    if (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > LIST_MAX_LIMIT) {
      invalid();
    }
    parsedLimit = Number(limit);
  }
  return {
    status: status === undefined ? null : (status as InvitationStatus),
    limit: parsedLimit,
    cursor: cursor === undefined ? null : decodeCursor(cursor),
  };
}
