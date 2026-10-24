import { ApiResult } from './api.js';
import { Clock } from './controller.js';
import {
  EMPTY_PERMISSIONS,
  hasAnyPermission,
  isCompleteCode,
  isValidPhone,
  normalizeFullName,
  normalizeNote,
  normalizeReason,
  PermissionsDraft,
} from './inputs.js';
import { ADMIN_COPY } from './messages.js';
import {
  AdminProvisioningApi,
  InvitationApp,
  InvitationDetail,
  InvitationStatus,
  InvitationSummary,
  IssuedInvitation,
  OperationRequest,
  Permission,
} from './provisioning-api.js';

// SYSTEM invitation management as a DOM-free state machine (unit tested in Node).
//
// Rules:
//  * Every mutation is: createOperation (server fingerprints the payload, 120 s) -> verifyOperation (a fresh Authenticator
//    code) -> the business POST with ONE Idempotency-Key and the operation id.
//  * Nothing is sent twice by itself. A lost answer to the code step is read with GET /operations/:id; a lost answer to
//    the business POST leaves the screen in "retry" and only a click sends it again, with the SAME key and operation, so
//    the server replays instead of creating a second invitation. The Authenticator code is never sent twice by this class.
//  * The activation link (a secret) exists only in the screen object of the result page and is dropped when the user
//    leaves it. It is never written to storage, the URL or a log.
//  * A 401 means the session is gone (back to login); a 403 ADMIN_FORBIDDEN shows the "no permission" screen. The page
//    never decides who may do what: it only hides what the server would refuse.

export interface SessionPort {
  /** The SESSION CSRF token of the shell, or undefined when there is no session. */
  csrf(): string | undefined;
  lost(): void;
  refresh(): Promise<boolean>;
}

export type FilterStatus = InvitationStatus | 'ALL';
export type ComposeKind = 'create' | 'reissue' | 'revoke';
export type CodeError = 'totp' | 'unavailable';
export type ComposePhase = 'form' | 'code' | 'working' | 'retry' | 'done';

export interface ComposeDraft {
  readonly fullName: string;
  readonly phone: string;
  readonly note: string;
  readonly permissions: PermissionsDraft;
  readonly reason: string;
  /** Reissue only: keep the old permissions (key absent) or replace them with `permissions`. */
  readonly keepPermissions: boolean;
}

export interface FieldErrors {
  readonly fullName?: string;
  readonly phone?: string;
  readonly note?: string;
  readonly permissions?: string;
  readonly reason?: string;
}

export type ComposeResult =
  | { readonly kind: 'issued'; readonly issued: IssuedInvitation }
  | { readonly kind: 'revoked'; readonly invitation: InvitationDetail };

export type ProvisioningScreen =
  | {
      readonly name: 'list';
      readonly filter: FilterStatus;
      readonly items: readonly InvitationSummary[];
      readonly nextCursor: string | null;
      readonly loading: boolean;
      readonly loadingMore: boolean;
      readonly error?: string;
    }
  | {
      readonly name: 'detail';
      readonly id: string;
      readonly loading: boolean;
      readonly invitation?: InvitationDetail;
      readonly notFound: boolean;
      readonly error?: string;
    }
  | {
      readonly name: 'compose';
      readonly kind: ComposeKind;
      /** The invitation being reissued/revoked (reissue and revoke only). */
      readonly target?: InvitationDetail;
      readonly targetError?: string;
      readonly loadingTarget: boolean;
      readonly phase: ComposePhase;
      readonly draft: ComposeDraft;
      readonly fieldErrors: FieldErrors;
      readonly formError?: string;
      readonly notice?: string;
      readonly codeError?: CodeError;
      /** Bumped whenever the code field must be emptied. */
      readonly codeReset: number;
      readonly pending: boolean;
      readonly operationExpiresAtMs?: number;
      readonly lockUntilMs?: number;
      readonly result?: ComposeResult;
    }
  | { readonly name: 'forbidden' };

type Listener = (screen: ProvisioningScreen) => void;

const LIST_LIMIT = 20;
const TIMER_MAX_MS = 2_147_000_000;

export const EMPTY_DRAFT: ComposeDraft = {
  fullName: '',
  phone: '',
  note: '',
  permissions: EMPTY_PERMISSIONS,
  reason: '',
  keepPermissions: true,
};

/** The permissions the form sends: only apps with VIEW, in the wire shape. */
export function permissionsOfDraft(draft: PermissionsDraft): Permission[] {
  const apps: InvitationApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];
  return apps.flatMap((app) => {
    const rights = draft[app];
    return rights.canView
      ? [{ app, canView: true, canReviewProfile: rights.canReviewProfile, canLock: rights.canLock, ...(app === 'SHOP' && rights.canManageCatalog === true ? { canManageCatalog: true } : {}), ...(app === 'SHOP' && rights.canManageShops === true ? { canManageShops: true } : {}) }]
      : [];
  });
}

export function draftOfPermissions(permissions: readonly Permission[]): PermissionsDraft {
  const draft = { ...EMPTY_PERMISSIONS } as Record<InvitationApp, PermissionsDraft[InvitationApp]>;
  for (const permission of permissions) {
    draft[permission.app] = {
      canView: permission.canView,
      canReviewProfile: permission.canReviewProfile,
      canLock: permission.canLock,
      ...(permission.canManageCatalog === true ? { canManageCatalog: true } : {}),
      ...(permission.canManageShops === true ? { canManageShops: true } : {}),
    };
  }
  return draft;
}

/** Operation in flight: what was fingerprinted by the server, the key of the business request, and the operation id. */
interface Flow {
  readonly request: OperationRequest;
  readonly key: string;
  operationId?: string;
}

export class ProvisioningController {
  #screen: ProvisioningScreen = { name: 'list', filter: 'ALL', items: [], nextCursor: null, loading: false, loadingMore: false };
  #listeners = new Set<Listener>();
  #generation = 0;
  #flow: Flow | undefined;
  #timer: unknown;
  #lockTimer: unknown;

  constructor(
    private readonly api: AdminProvisioningApi,
    private readonly session: SessionPort,
    private readonly clock: Clock,
    private readonly newKey: () => string,
  ) {}

  get screen(): ProvisioningScreen {
    return this.#screen;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Seconds left of a rate limit, 0 when none. */
  lockRemainingSeconds(): number {
    const screen = this.#screen;
    if (screen.name !== 'compose' || screen.lockUntilMs === undefined) {
      return 0;
    }
    return Math.max(0, Math.ceil((screen.lockUntilMs - this.clock.now()) / 1000));
  }

  // ---- reads ----

  async openList(filter: FilterStatus): Promise<void> {
    const generation = this.#reset();
    this.#set({ name: 'list', filter, items: [], nextCursor: null, loading: true, loadingMore: false });
    const result = await this.api.listInvitations(this.#query(filter, undefined));
    if (generation !== this.#generation || this.#screen.name !== 'list') {
      return;
    }
    const screen = this.#screen;
    if (result.kind === 'ok') {
      this.#set({ ...screen, loading: false, items: result.data.items, nextCursor: result.data.nextCursor });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    this.#set({ ...screen, loading: false, error: 'unavailable' });
  }

  async loadMore(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'list' || screen.loading || screen.loadingMore || screen.nextCursor === null) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, loadingMore: true, error: undefined });
    const result = await this.api.listInvitations(this.#query(screen.filter, screen.nextCursor));
    if (generation !== this.#generation || this.#screen.name !== 'list') {
      return;
    }
    const current = this.#screen;
    if (result.kind === 'ok') {
      this.#set({ ...current, loadingMore: false, items: [...current.items, ...result.data.items], nextCursor: result.data.nextCursor });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    this.#set({ ...current, loadingMore: false, error: 'unavailable' });
  }

  async openDetail(id: string): Promise<void> {
    const generation = this.#reset();
    this.#set({ name: 'detail', id, loading: true, notFound: false });
    const result = await this.api.getInvitation(id);
    if (generation !== this.#generation || this.#screen.name !== 'detail') {
      return;
    }
    if (result.kind === 'ok') {
      this.#set({ name: 'detail', id, loading: false, invitation: result.data, notFound: false });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    if (result.kind === 'error' && result.code === 'ADMIN_INVITATION_NOT_FOUND') {
      this.#set({ name: 'detail', id, loading: false, notFound: true });
      return;
    }
    this.#set({ name: 'detail', id, loading: false, notFound: false, error: 'unavailable' });
  }

  // ---- compose (create / reissue / revoke) ----

  /** Opens the form. Reissue and revoke first read the invitation, so version and permissions are the server's. */
  async openCompose(kind: ComposeKind, invitationId?: string): Promise<void> {
    const generation = this.#reset();
    const base = {
      name: 'compose' as const,
      kind,
      phase: 'form' as const,
      draft: EMPTY_DRAFT,
      fieldErrors: {},
      codeReset: 0,
      pending: false,
    };
    if (kind === 'create' || invitationId === undefined) {
      this.#set({ ...base, loadingTarget: false });
      return;
    }
    this.#set({ ...base, loadingTarget: true });
    const result = await this.api.getInvitation(invitationId);
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return;
    }
    const screen = this.#screen;
    if (result.kind === 'ok') {
      const target = result.data;
      this.#set({
        ...screen,
        loadingTarget: false,
        target,
        draft: { ...EMPTY_DRAFT, permissions: draftOfPermissions(target.permissions) },
        ...(target.status === 'PENDING' ? {} : { formError: ADMIN_COPY.notPending }),
      });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    this.#set({
      ...screen,
      loadingTarget: false,
      targetError: result.kind === 'error' && result.code === 'ADMIN_INVITATION_NOT_FOUND' ? ADMIN_COPY.invitationNotFound : 'unavailable',
    });
  }

  /** Step 1: validate, then ask the server to open an operation for exactly this payload. */
  async submitForm(draft: ComposeDraft): Promise<'sent' | 'invalid' | 'ignored'> {
    const screen = this.#screen;
    if (screen.name !== 'compose' || screen.phase !== 'form' || screen.pending || screen.loadingTarget) {
      return 'ignored';
    }
    if (screen.kind !== 'create' && (screen.target === undefined || screen.target.status !== 'PENDING')) {
      return 'ignored';
    }
    const built = this.#build(screen, draft);
    if (built.errors !== undefined) {
      this.#set({ ...screen, draft, fieldErrors: built.errors, formError: undefined, notice: undefined });
      return 'invalid';
    }
    const csrf = this.session.csrf();
    if (csrf === undefined) {
      return 'ignored';
    }
    const generation = this.#advance();
    this.#set({ ...screen, draft, fieldErrors: {}, formError: undefined, notice: undefined, pending: true });
    // One idempotency key per logical request: created here, kept through every deliberate repeat of the business POST.
    const flow: Flow = { request: built.request, key: this.newKey() };
    const result = await this.api.createOperation(csrf, built.request);
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return 'sent';
    }
    const current = this.#screen;
    if (result.kind === 'ok') {
      flow.operationId = result.data.operationId;
      this.#flow = flow;
      const expiresMs = Date.parse(result.data.expiresAt);
      this.#set({
        ...current,
        phase: 'code',
        pending: false,
        codeError: undefined,
        codeReset: current.codeReset + 1,
        ...(Number.isFinite(expiresMs) ? { operationExpiresAtMs: expiresMs } : {}),
      });
      this.#armOperationTimer(expiresMs);
      return 'sent';
    }
    await this.#formFailure(current, result);
    return 'sent';
  }

  /** Step 2: the fresh Authenticator code, then (once verified) the business request. */
  async submitCode(code: string): Promise<'sent' | 'incomplete' | 'ignored'> {
    const screen = this.#screen;
    const flow = this.#flow;
    if (screen.name !== 'compose' || screen.phase !== 'code' || screen.pending || flow?.operationId === undefined) {
      return 'ignored';
    }
    if (this.#locked(screen)) {
      return 'ignored';
    }
    if (!isCompleteCode(code)) {
      return 'incomplete';
    }
    const csrf = this.session.csrf();
    if (csrf === undefined) {
      return 'ignored';
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, codeError: undefined, lockUntilMs: undefined });
    const verified = await this.api.verifyOperation(csrf, flow.operationId, code);
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return 'sent';
    }
    const current = this.#screen;
    if (verified.kind === 'ok') {
      await this.#runBusiness(generation);
      return 'sent';
    }
    if (verified.kind === 'network' || verified.status >= 500) {
      // The code may have been consumed. Read the operation; never send the code again.
      await this.#afterLostVerify(generation, flow.operationId);
      return 'sent';
    }
    if (this.#handleAccess(verified)) {
      return 'sent';
    }
    switch (verified.code) {
      case 'ADMIN_TOTP_INVALID':
        this.#set({ ...current, pending: false, codeError: 'totp', codeReset: current.codeReset + 1 });
        break;
      case 'ADMIN_STEP_UP_REQUIRED':
        this.#backToForm(current, ADMIN_COPY.stepUpGone);
        break;
      case 'ADMIN_CSRF_INVALID':
        await this.#afterCsrfInvalid(current);
        break;
      case 'ADMIN_AUTH_RATE_LIMITED':
      case 'OTP_RATE_LIMITED':
        this.#set({ ...current, pending: false, ...this.#lockFrom(verified) });
        break;
      default:
        this.#set({ ...current, pending: false, codeError: 'unavailable' });
    }
    return 'sent';
  }

  /**
   * "Kiểm tra lại" after a lost/unclear business answer: the SAME request, key and operation id again. The server replays
   * the stored answer, so no second invitation and no second Authenticator code are involved.
   */
  async retryBusiness(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'compose' || screen.phase !== 'retry' || screen.pending || this.#flow?.operationId === undefined) {
      return;
    }
    // Retry-After is respected: nothing is sent while the wait runs (the button is disabled too). Key, operation id and
    // payload stay those of the flow.
    if (this.#locked(screen)) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, formError: undefined, lockUntilMs: undefined });
    await this.#runBusiness(generation);
  }

  /** Back from the code step to the form (the operation is abandoned; the next submit opens a new one). */
  backToForm(): void {
    const screen = this.#screen;
    if (screen.name === 'compose' && (screen.phase === 'code' || screen.phase === 'retry') && !screen.pending) {
      this.#backToForm(screen, undefined);
    }
  }

  /** The user leaves the result page: the link and the flow are dropped. */
  clear(): void {
    this.#reset();
    // No emit: nobody is looking. The result (with the link) must not stay in memory after the page is left.
    this.#screen = { name: 'list', filter: 'ALL', items: [], nextCursor: null, loading: false, loadingMore: false };
  }

  // ---- internals ----

  #query(filter: FilterStatus, cursor: string | undefined) {
    return { limit: LIST_LIMIT, ...(filter === 'ALL' ? {} : { status: filter }), ...(cursor === undefined ? {} : { cursor }) };
  }

  #build(
    screen: Extract<ProvisioningScreen, { name: 'compose' }>,
    draft: ComposeDraft,
  ): { request: OperationRequest; errors?: undefined } | { errors: FieldErrors; request?: undefined } {
    const errors: { -readonly [K in keyof FieldErrors]: FieldErrors[K] } = {};
    if (screen.kind === 'create') {
      const fullName = normalizeFullName(draft.fullName);
      const note = normalizeNote(draft.note);
      if (fullName === undefined) {
        errors.fullName = ADMIN_COPY.fullNameInvalid;
      }
      if (!isValidPhone(draft.phone)) {
        errors.phone = 'Số điện thoại không hợp lệ.';
      }
      if (note === undefined) {
        errors.note = ADMIN_COPY.noteTooLong;
      }
      if (!hasAnyPermission(draft.permissions)) {
        errors.permissions = ADMIN_COPY.permissionsRequired;
      }
      if (Object.keys(errors).length > 0 || fullName === undefined || note === undefined) {
        return { errors };
      }
      return {
        request: {
          action: 'CREATE_INVITATION',
          fullName,
          phone: draft.phone.trim(),
          note,
          permissions: permissionsOfDraft(draft.permissions),
        },
      };
    }
    const target = screen.target;
    const reason = normalizeReason(draft.reason);
    if (reason === undefined) {
      errors.reason = ADMIN_COPY.reasonInvalid;
    }
    const replacing = screen.kind === 'reissue' && !draft.keepPermissions;
    if (replacing && !hasAnyPermission(draft.permissions)) {
      errors.permissions = ADMIN_COPY.permissionsRequired;
    }
    if (Object.keys(errors).length > 0 || reason === undefined || target === undefined) {
      return { errors };
    }
    if (screen.kind === 'revoke') {
      return { request: { action: 'REVOKE_INVITATION', invitationId: target.invitationId, expectedVersion: target.version, reason } };
    }
    return {
      request: {
        action: 'REISSUE_INVITATION',
        invitationId: target.invitationId,
        expectedVersion: target.version,
        reason,
        permissions: replacing ? permissionsOfDraft(draft.permissions) : null,
      },
    };
  }

  async #runBusiness(generation: number): Promise<void> {
    const flow = this.#flow;
    const screen = this.#screen;
    if (flow?.operationId === undefined || screen.name !== 'compose') {
      return;
    }
    const csrf = this.session.csrf();
    if (csrf === undefined) {
      return;
    }
    this.#set({ ...screen, phase: 'working', pending: true, codeError: undefined, formError: undefined });
    this.#clearTimer();
    const { request, key, operationId } = flow;
    let result: ApiResult<ComposeResult>;
    switch (request.action) {
      case 'CREATE_INVITATION': {
        const issued = await this.api.createInvitation(csrf, key, operationId, request);
        result = issued.kind === 'ok' ? { kind: 'ok', data: { kind: 'issued', issued: issued.data } } : issued;
        break;
      }
      case 'REISSUE_INVITATION': {
        const issued = await this.api.reissueInvitation(csrf, key, operationId, request);
        result = issued.kind === 'ok' ? { kind: 'ok', data: { kind: 'issued', issued: issued.data } } : issued;
        break;
      }
      case 'REVOKE_INVITATION': {
        const revoked = await this.api.revokeInvitation(csrf, key, operationId, request);
        result = revoked.kind === 'ok' ? { kind: 'ok', data: { kind: 'revoked', invitation: revoked.data } } : revoked;
        break;
      }
    }
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return;
    }
    const current = this.#screen;
    if (result.kind === 'ok') {
      this.#flow = undefined;
      this.#set({ ...current, phase: 'done', pending: false, result: result.data, codeError: undefined, formError: undefined });
      return;
    }
    if (result.kind === 'network' || result.status >= 500) {
      // 503 TRANSACTION_OUTCOME_UNKNOWN and any lost answer: the server may have committed. Same key on the next click.
      this.#set({ ...current, phase: 'retry', pending: false, formError: ADMIN_COPY.outcomeUnknown });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    switch (result.code) {
      case 'ADMIN_CSRF_INVALID':
        // Rejected before anything ran; a fresh token is read and the user clicks again with the same key.
        await this.session.refresh();
        if (generation === this.#generation && this.#screen.name === 'compose') {
          this.#set({ ...this.#screen, phase: 'retry', pending: false, formError: ADMIN_COPY.outcomeUnknown });
        }
        return;
      case 'ADMIN_STEP_UP_REQUIRED':
        // Consumed or expired. If an earlier try executed, the replay would have answered; say the outcome is unclear.
        this.#set({ ...current, phase: 'retry', pending: false, formError: ADMIN_COPY.outcomeUnknownFinal });
        this.#flow = undefined;
        return;
      case 'ADMIN_AUTH_RATE_LIMITED':
        this.#set({ ...current, phase: 'retry', pending: false, formError: ADMIN_COPY.rateLimited, ...this.#lockFrom(result) });
        return;
      default:
        await this.#formFailure(current, result);
    }
  }

  /** The business code of a failed operation/business call -> back to the form with an explanation. */
  async #formFailure(current: Extract<ProvisioningScreen, { name: 'compose' }>, result: ApiResult<unknown>): Promise<void> {
    if (result.kind !== 'error') {
      this.#set({ ...current, phase: 'form', pending: false, formError: ADMIN_COPY.connectionLost });
      return;
    }
    if (this.#handleAccess(result)) {
      return;
    }
    if (result.code === 'ADMIN_CSRF_INVALID') {
      await this.#afterCsrfInvalid(current);
      return;
    }
    if (result.code === 'ADMIN_AUTH_RATE_LIMITED') {
      this.#set({ ...current, phase: 'form', pending: false, formError: ADMIN_COPY.rateLimited });
      return;
    }
    const message = this.#messageOf(result.code);
    this.#flow = undefined;
    this.#clearTimer();
    this.#set({ ...current, phase: 'form', pending: false, formError: message });
  }

  #messageOf(code: string): string {
    switch (code) {
      case 'ADMIN_INVITATION_PENDING_EXISTS':
        return ADMIN_COPY.pendingExists;
      case 'ADMIN_PHONE_CONFLICT':
        return ADMIN_COPY.phoneConflict;
      case 'ADMIN_VERSION_CONFLICT':
        return ADMIN_COPY.versionConflict;
      case 'ADMIN_INVITATION_NOT_PENDING':
        return ADMIN_COPY.notPending;
      case 'ADMIN_INVITATION_NOT_FOUND':
        return ADMIN_COPY.invitationNotFound;
      case 'ADMIN_INPUT_INVALID':
        return ADMIN_COPY.inputInvalid;
      case 'ADMIN_INVITATION_NOT_REPLAYABLE':
        return ADMIN_COPY.notReplayable;
      case 'IDEMPOTENCY_KEY_REUSED':
      case 'IDEMPOTENCY_KEY_CONFLICT':
      case 'IDEMPOTENCY_KEY_INVALID':
      case 'IDEMPOTENCY_IN_PROGRESS':
        return ADMIN_COPY.idempotencyConflict;
      default:
        return ADMIN_COPY.connectionLost;
    }
  }

  async #afterCsrfInvalid(current: Extract<ProvisioningScreen, { name: 'compose' }>): Promise<void> {
    const generation = this.#generation;
    const refreshed = await this.session.refresh();
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return;
    }
    if (refreshed) {
      this.#flow = undefined;
      this.#clearTimer();
      this.#set({ ...current, phase: 'form', pending: false, formError: ADMIN_COPY.stepChangedAdmin });
    }
  }

  async #afterLostVerify(generation: number, operationId: string): Promise<void> {
    const read = await this.api.readOperation(operationId);
    if (generation !== this.#generation || this.#screen.name !== 'compose') {
      return;
    }
    const current = this.#screen;
    if (read.kind === 'ok') {
      if (read.data.usable) {
        // The code was accepted: carry on with the business request. This is the user's single confirmation.
        await this.#runBusiness(generation);
        return;
      }
      if (read.data.verifiable) {
        this.#set({ ...current, pending: false, codeError: 'unavailable', codeReset: current.codeReset + 1 });
        return;
      }
      this.#backToForm(current, ADMIN_COPY.stepUpExpired);
      return;
    }
    if (this.#handleAccess(read)) {
      return;
    }
    if (read.kind === 'error' && read.code === 'ADMIN_STEP_UP_REQUIRED') {
      this.#backToForm(current, ADMIN_COPY.stepUpGone);
      return;
    }
    this.#set({ ...current, pending: false, codeError: 'unavailable' });
  }

  #backToForm(current: Extract<ProvisioningScreen, { name: 'compose' }>, notice: string | undefined): void {
    this.#flow = undefined;
    this.#clearTimer();
    this.#set({
      ...current,
      phase: 'form',
      pending: false,
      codeError: undefined,
      lockUntilMs: undefined,
      operationExpiresAtMs: undefined,
      ...(notice === undefined ? {} : { notice }),
    });
  }

  /** 401 -> login; 403 ADMIN_FORBIDDEN -> no-permission screen. Returns true when it handled the result. */
  #handleAccess(result: ApiResult<unknown>): boolean {
    if (result.kind !== 'error') {
      return false;
    }
    if (result.status === 401) {
      this.#flow = undefined;
      this.#clearTimer();
      this.session.lost();
      return true;
    }
    if (result.status === 403 && result.code === 'ADMIN_FORBIDDEN') {
      this.#flow = undefined;
      this.#clearTimer();
      this.#set({ name: 'forbidden' });
      return true;
    }
    return false;
  }

  #lockFrom(result: { retryAfterSeconds?: number }): { lockUntilMs: number } {
    return { lockUntilMs: this.clock.now() + (result.retryAfterSeconds ?? 30) * 1000 };
  }

  #locked(screen: Extract<ProvisioningScreen, { name: 'compose' }>): boolean {
    return screen.lockUntilMs !== undefined && screen.lockUntilMs > this.clock.now();
  }

  /** At the operation's expiry the form comes back (no request): the next submit opens a new operation. */
  #armOperationTimer(expiresMs: number): void {
    this.#clearTimer();
    if (!Number.isFinite(expiresMs)) {
      return;
    }
    const delay = Math.min(TIMER_MAX_MS, Math.max(0, expiresMs - this.clock.now()) + 250);
    this.#timer = this.clock.setTimeout(() => {
      this.#timer = undefined;
      const screen = this.#screen;
      if (screen.name !== 'compose' || screen.phase !== 'code') {
        return;
      }
      if (screen.pending) {
        this.#armOperationTimer(this.clock.now() + 2000);
        return;
      }
      this.#backToForm(screen, ADMIN_COPY.stepUpExpired);
    }, delay);
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      this.clock.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #advance(): number {
    this.#generation += 1;
    return this.#generation;
  }

  /** Leaving a screen: older answers are ignored, the flow (key, operation, link) is dropped. */
  #reset(): number {
    this.#flow = undefined;
    this.#clearTimer();
    return this.#advance();
  }

  #set(screen: ProvisioningScreen): void {
    this.#screen = screen;
    if (this.#lockTimer !== undefined) {
      this.clock.clearTimeout(this.#lockTimer);
      this.#lockTimer = undefined;
    }
    if (screen.name === 'compose' && screen.lockUntilMs !== undefined) {
      const delay = Math.min(TIMER_MAX_MS, Math.max(0, screen.lockUntilMs - this.clock.now()));
      this.#lockTimer = this.clock.setTimeout(() => {
        this.#lockTimer = undefined;
        if (this.#screen === screen) {
          // The wait is over: the button is usable again. Nothing is sent by itself.
          this.#set({ ...screen, lockUntilMs: undefined });
        }
      }, delay);
    }
    for (const listener of this.#listeners) {
      listener(screen);
    }
  }
}
