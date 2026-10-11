import {
  ActivationView,
  AdminActivationApi,
  InvalidatedReason,
  OtpInfo,
  viewFromStepInvalid,
} from './activation-api.js';
import { ApiResult } from './api.js';
import { Clock } from './controller.js';
import { isCompleteCode, isValidPassword } from './inputs.js';
import { ADMIN_COPY } from './messages.js';

// The ADMIN activation flow (public, no admin session) as a DOM-free state machine.
//
// Rules:
//  * The SERVER decides the step. Every screen comes from a server answer (start / state / the step's own answer / the
//    `details` of a STEP_INVALID); reload = GET /state, which is a pure read.
//  * The invitation token is held in this object's memory only while the first `start` may still need to be repeated by
//    the user (a lost answer); it is dropped as soon as an answer arrives. The page removes it from the address bar
//    before this class is even called. It is never written to storage, a URL or a log.
//  * Nothing is sent twice by itself. A lost answer to "send the SMS", "verify the SMS code", "set the password" or
//    "confirm the Authenticator code" is followed by a READ of GET /state only; the user decides about any repeat.
//  * The password, the SMS code, the TOTP code, the otpauth URI and the secret are never kept after the step that needs
//    them. `displayedCode` (TEST_DISPLAY only) is shown on the OTP screen and dropped with it.
//  * Finishing does NOT log in: the last screen sends the user to the login page.

export type OtpCodeError = 'invalid' | 'expired' | 'locked' | 'unavailable';
export type TotpCodeError = 'invalid' | 'unavailable';

export type ActivationScreen =
  | { readonly name: 'starting' }
  | { readonly name: 'unavailable'; readonly pending: boolean }
  | { readonly name: 'link-invalid' }
  | { readonly name: 'session-expired' }
  | { readonly name: 'rate-limited'; readonly untilMs: number }
  | {
      readonly name: 'invalidated';
      readonly reason: InvalidatedReason;
      readonly canRestart: boolean;
      readonly pending: boolean;
      readonly error?: string;
      /** A restart whose outcome could not be read (its answer was lost and GET /state failed too): only a READ may follow. */
      readonly stateUnknown?: boolean;
    }
  | {
      readonly name: 'otp';
      readonly otp?: OtpInfo;
      readonly resendAtMs?: number;
      /** Present only with the TEST_DISPLAY provider. */
      readonly displayedCode?: string;
      readonly pending: boolean;
      readonly sendError?: string;
      readonly codeError?: OtpCodeError;
      readonly notice?: string;
      readonly codeReset: number;
    }
  | {
      readonly name: 'password';
      readonly pending: boolean;
      readonly error?: string;
      readonly restartRequired: boolean;
      readonly passwordDeadlineMs?: number;
      readonly notice?: string;
      /** Same as on `invalidated`: the restart outcome is unknown; the only action is to read the state again. */
      readonly stateUnknown?: boolean;
    }
  | {
      readonly name: 'enroll';
      readonly secret?: string;
      readonly otpauthUri?: string;
      readonly loading: boolean;
      readonly loadError?: string;
      readonly showKey: boolean;
      readonly attemptsLeft?: number;
      readonly pending: boolean;
      readonly codeError?: TotpCodeError;
      readonly lockUntilMs?: number;
      readonly notice?: string;
      readonly codeReset: number;
    }
  | { readonly name: 'done' };

type Listener = (screen: ActivationScreen) => void;
type Action<T> = ApiResult<T>;

const TIMER_MAX_MS = 2_147_000_000;

export class ActivationController {
  #screen: ActivationScreen = { name: 'starting' };
  #listeners = new Set<Listener>();
  #generation = 0;
  #csrf: string | undefined;
  #expiresAtMs: number | undefined;
  /** Kept only until the first `start` has been answered, so "Thử lại" can send it again after a lost answer. */
  #token: string | undefined;
  #expiryTimer: unknown;
  #stepTimer: unknown;

  constructor(
    private readonly api: AdminActivationApi,
    private readonly clock: Clock,
  ) {}

  get screen(): ActivationScreen {
    return this.#screen;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Seconds until the next allowed SMS / TOTP try, 0 when none. */
  waitSeconds(): number {
    const screen = this.#screen;
    const until =
      screen.name === 'otp' ? screen.resendAtMs : screen.name === 'enroll' ? screen.lockUntilMs : screen.name === 'rate-limited' ? screen.untilMs : undefined;
    return until === undefined ? 0 : Math.max(0, Math.ceil((until - this.clock.now()) / 1000));
  }

  /**
   * Page open. With a token (the fragment was present): POST /start. Without one (reload, fragment already removed):
   * GET /state. The token argument is the only place the token enters this object.
   */
  async begin(token: string | undefined): Promise<void> {
    const generation = this.#advance();
    this.#set({ name: 'starting' });
    if (token === undefined) {
      await this.#readState(generation);
      return;
    }
    this.#token = token;
    await this.#start(generation);
  }

  /** A fragment was present but is not a well-formed token: the same answer the server gives, without sending anything. */
  rejectLink(): void {
    this.#advance();
    this.#forget();
    this.#set({ name: 'link-invalid' });
  }

  /** "Thử lại" on the unavailable screen: repeats the read, or the first start if its answer was lost. */
  async retry(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'unavailable' || screen.pending) {
      return;
    }
    const generation = this.#advance();
    this.#set({ name: 'unavailable', pending: true });
    if (this.#token !== undefined) {
      await this.#start(generation);
    } else {
      await this.#readState(generation);
    }
  }

  // ---- step A: SMS ----

  async requestOtp(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'otp' || screen.pending || this.#csrf === undefined || this.waitSeconds() > 0) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, sendError: undefined, codeError: undefined, notice: undefined });
    const result = await this.api.requestOtp(this.#csrf);
    if (!this.#current(generation)) {
      return;
    }
    if (result.kind === 'ok') {
      const resendMs = Date.parse(result.data.resendAt);
      const current = this.#screen;
      if (current.name === 'otp') {
        this.#set({
          ...current,
          pending: false,
          otp: { status: 'SUBMITTED', resendAt: result.data.resendAt },
          ...(Number.isFinite(resendMs) ? { resendAtMs: resendMs } : {}),
          ...(result.data.displayedCode === undefined ? {} : { displayedCode: result.data.displayedCode }),
          notice: ADMIN_COPY.otpSent,
          codeReset: current.codeReset + 1,
        });
      }
      return;
    }
    // The SMS may or may not have gone out. Only a READ follows; the user decides about any new request.
    await this.#followUp(generation, result, 'send');
  }

  async verifyOtp(code: string): Promise<'sent' | 'incomplete' | 'ignored'> {
    const screen = this.#screen;
    if (screen.name !== 'otp' || screen.pending || this.#csrf === undefined) {
      return 'ignored';
    }
    if (!isCompleteCode(code)) {
      return 'incomplete';
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, codeError: undefined, notice: undefined });
    const result = await this.api.verifyOtp(this.#csrf, code);
    if (!this.#current(generation)) {
      return 'sent';
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return 'sent';
    }
    await this.#followUp(generation, result, 'verify');
    return 'sent';
  }

  // ---- step B: password ----

  /** Validates, sends once. The password is not kept anywhere by this class. */
  async submitPassword(password: string, confirmation: string): Promise<'sent' | 'invalid' | 'mismatch' | 'ignored'> {
    const screen = this.#screen;
    if (screen.name !== 'password' || screen.pending || screen.restartRequired || this.#csrf === undefined) {
      return 'ignored';
    }
    if (!isValidPassword(password)) {
      this.#set({ ...screen, error: ADMIN_COPY.passwordInvalid });
      return 'invalid';
    }
    if (password !== confirmation) {
      this.#set({ ...screen, error: ADMIN_COPY.passwordMismatch });
      return 'mismatch';
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, error: undefined, notice: undefined });
    const result = await this.api.setPassword(this.#csrf, password);
    if (!this.#current(generation)) {
      return 'sent';
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return 'sent';
    }
    await this.#followUp(generation, result, 'password');
    return 'sent';
  }

  // ---- step C: Authenticator ----

  /** Loads (or re-loads: it is replayable and returns the same secret) the key and the QR source. */
  async loadEnrollment(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'enroll' || screen.loading || this.#csrf === undefined) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, loading: true, loadError: undefined });
    const result = await this.api.enrollment(this.#csrf);
    if (!this.#current(generation)) {
      return;
    }
    const current = this.#screen;
    if (result.kind === 'ok' && current.name === 'enroll') {
      this.#set({ ...current, loading: false, secret: result.data.secret, otpauthUri: result.data.otpauthUri });
      return;
    }
    if (result.kind === 'error' && (await this.#handleCommonError(generation, result))) {
      return;
    }
    if (this.#screen.name === 'enroll') {
      this.#set({ ...this.#screen, loading: false, loadError: 'unavailable' });
    }
  }

  toggleKey(): void {
    if (this.#screen.name === 'enroll') {
      this.#set({ ...this.#screen, showKey: !this.#screen.showKey });
    }
  }

  async complete(code: string): Promise<'sent' | 'incomplete' | 'ignored'> {
    const screen = this.#screen;
    if (screen.name !== 'enroll' || screen.pending || screen.secret === undefined || this.#csrf === undefined) {
      return 'ignored';
    }
    if (screen.lockUntilMs !== undefined && screen.lockUntilMs > this.clock.now()) {
      return 'ignored';
    }
    if (!isCompleteCode(code)) {
      return 'incomplete';
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, codeError: undefined, notice: undefined, lockUntilMs: undefined });
    const result = await this.api.complete(this.#csrf, code);
    if (!this.#current(generation)) {
      return 'sent';
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return 'sent';
    }
    await this.#followUp(generation, result, 'complete');
    return 'sent';
  }

  // ---- restart ----

  async restart(): Promise<void> {
    const screen = this.#screen;
    const csrf = this.#csrf;
    const allowed =
      (screen.name === 'invalidated' && screen.canRestart && !screen.pending && screen.stateUnknown !== true) ||
      (screen.name === 'password' && screen.restartRequired && !screen.pending && screen.stateUnknown !== true);
    if (!allowed || csrf === undefined || (screen.name !== 'invalidated' && screen.name !== 'password')) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, error: undefined });
    const result = await this.api.restart(csrf);
    if (!this.#current(generation)) {
      return;
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return;
    }
    if (result.kind === 'error' && result.status < 500) {
      // A refusal: the server did not restart anything. Common codes resync; otherwise say the step changed.
      if (await this.#handleCommonError(generation, result)) {
        return;
      }
      const current = this.#screen;
      if (current.name === 'invalidated' || current.name === 'password') {
        this.#set({ ...current, pending: false, error: ADMIN_COPY.stepChangedAdmin });
      }
      return;
    }
    // Network error or 5xx: the restart may have been committed. NEVER send the POST again; read where the attempt is.
    await this.#readAfterRestart(generation);
  }

  /** "Kiểm tra lại trạng thái": repeats the READ (GET /state) after a restart whose outcome is unknown. Never a POST. */
  async retryRead(): Promise<void> {
    const screen = this.#screen;
    if ((screen.name !== 'invalidated' && screen.name !== 'password') || screen.stateUnknown !== true || screen.pending) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, error: undefined });
    await this.#readAfterRestart(generation);
  }

  /**
   * GET /state after a restart with no usable answer. The server's answer decides the screen: a new attempt (the restart
   * was committed) or the old one (it was not), each with its own CSRF token. If the read fails too, the screen says the
   * outcome is unknown and offers only to read again.
   */
  async #readAfterRestart(generation: number): Promise<void> {
    const result = await this.api.state();
    if (!this.#current(generation)) {
      return;
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return;
    }
    if (result.kind === 'error' && (result.status === 401 || result.code === 'ADMIN_ACTIVATION_SESSION_INVALID')) {
      this.#forget();
      this.#set({ name: 'session-expired' });
      return;
    }
    if (result.kind === 'error' && result.status === 429) {
      this.#set({ name: 'rate-limited', untilMs: this.clock.now() + (result.retryAfterSeconds ?? 60) * 1000 });
      this.#armStepTimer();
      return;
    }
    const current = this.#screen;
    if (current.name === 'invalidated' || current.name === 'password') {
      this.#set({ ...current, pending: false, stateUnknown: true, error: ADMIN_COPY.restartUnknown });
    }
  }

  // ---- internals ----

  async #start(generation: number): Promise<void> {
    const token = this.#token;
    if (token === undefined) {
      return;
    }
    const result = await this.api.start(token);
    if (generation !== this.#generation) {
      return;
    }
    if (result.kind === 'ok') {
      this.#token = undefined;
      this.#enter(result.data, undefined);
      return;
    }
    if (result.kind === 'error') {
      this.#token = undefined;
      if (result.code === 'ADMIN_ACTIVATION_LINK_INVALID') {
        this.#set({ name: 'link-invalid' });
        return;
      }
      if (result.code === 'ADMIN_PHONE_CONFLICT') {
        this.#set({ name: 'invalidated', reason: 'PHONE_CONFLICT', canRestart: false, pending: false });
        return;
      }
      if (result.status === 429) {
        this.#set({ name: 'rate-limited', untilMs: this.clock.now() + (result.retryAfterSeconds ?? 60) * 1000 });
        this.#armStepTimer();
        return;
      }
      if (result.status >= 500) {
        // The token is still needed to repeat the start, so it stays in memory.
        this.#token = token;
      } else {
        this.#set({ name: 'link-invalid' });
        return;
      }
    }
    this.#set({ name: 'unavailable', pending: false });
  }

  async #readState(generation: number): Promise<void> {
    const result = await this.api.state();
    if (generation !== this.#generation) {
      return;
    }
    if (result.kind === 'ok') {
      this.#enter(result.data, undefined);
      return;
    }
    if (result.kind === 'error') {
      if (result.status === 401 || result.code === 'ADMIN_ACTIVATION_SESSION_INVALID') {
        // No attempt for this browser: with no token to start one, the person must open the link again.
        this.#forget();
        this.#set({ name: 'session-expired' });
        return;
      }
      if (result.status === 429) {
        this.#set({ name: 'rate-limited', untilMs: this.clock.now() + (result.retryAfterSeconds ?? 60) * 1000 });
        this.#armStepTimer();
        return;
      }
    }
    this.#set({ name: 'unavailable', pending: false });
  }

  /**
   * An error that is not a success of a step. First the codes every step shares (401, CSRF, STEP_INVALID, phone
   * conflict); then the step's own codes. A lost or unreadable answer is followed by a READ only.
   */
  async #followUp(generation: number, result: Exclude<Action<unknown>, { kind: 'ok' }>, step: 'send' | 'verify' | 'password' | 'complete'): Promise<void> {
    if (result.kind === 'error' && result.status < 500 && (await this.#handleCommonError(generation, result))) {
      return;
    }
    if (!this.#current(generation)) {
      return;
    }
    const code = result.kind === 'error' ? result.code : undefined;
    const screen = this.#screen;
    if (result.kind === 'error' && result.status < 500) {
      // The step's own refusal: show it, then read the state for what changed (attempts left, resend time).
      if (screen.name === 'otp') {
        if (code === 'OTP_INVALID') {
          this.#set({ ...screen, pending: false, codeError: 'invalid', codeReset: screen.codeReset + 1 });
        } else if (code === 'OTP_EXPIRED') {
          this.#set({ ...screen, pending: false, codeError: 'expired', codeReset: screen.codeReset + 1 });
        } else if (code === 'OTP_RATE_LIMITED') {
          // 429 without Retry-After: the time comes from GET /state (otp.resend_at / status).
          this.#set({ ...screen, pending: false, ...(step === 'send' ? { sendError: ADMIN_COPY.rateLimited } : { codeError: 'locked' as const }) });
        } else {
          this.#set({ ...screen, pending: false, ...(step === 'send' ? { sendError: 'unavailable' } : { codeError: 'unavailable' as const }) });
        }
      } else if (screen.name === 'password') {
        this.#set({ ...screen, pending: false, error: code === 'ADMIN_INPUT_INVALID' ? ADMIN_COPY.passwordInvalid : ADMIN_COPY.stepChangedAdmin });
      } else if (screen.name === 'enroll') {
        if (code === 'ADMIN_AUTH_RATE_LIMITED') {
          this.#set({
            ...screen,
            pending: false,
            lockUntilMs: this.clock.now() + (result.retryAfterSeconds ?? 60) * 1000,
            codeReset: screen.codeReset + 1,
          });
          this.#armStepTimer();
        } else {
          this.#set({ ...screen, pending: false, codeError: code === 'ADMIN_TOTP_INVALID' ? 'invalid' : 'unavailable', codeReset: screen.codeReset + 1 });
        }
      }
    } else if (screen.name === 'otp') {
      this.#set({ ...screen, pending: false, ...(step === 'send' ? { sendError: 'unavailable' } : { codeError: 'unavailable' as const }) });
    } else if (screen.name === 'password') {
      this.#set({ ...screen, pending: false, error: ADMIN_COPY.connectionLost });
    } else if (screen.name === 'enroll') {
      this.#set({ ...screen, pending: false, codeError: 'unavailable' });
    }
    // Lost answer or refusal: ask the server where the attempt is (a pure read; nothing is sent again).
    await this.#refreshFromState(generation);
  }

  /** Common failures: 401 (session), CSRF (resync), STEP_INVALID (the attempt is elsewhere), phone conflict. */
  async #handleCommonError(generation: number, result: Extract<Action<unknown>, { kind: 'error' }>): Promise<boolean> {
    switch (result.code) {
      case 'ADMIN_ACTIVATION_SESSION_INVALID':
        this.#forget();
        this.#set({ name: 'session-expired' });
        return true;
      case 'ADMIN_ACTIVATION_LINK_INVALID':
        this.#forget();
        this.#set({ name: 'link-invalid' });
        return true;
      case 'ADMIN_PHONE_CONFLICT':
        this.#forget();
        this.#set({ name: 'invalidated', reason: 'PHONE_CONFLICT', canRestart: false, pending: false });
        return true;
      case 'ADMIN_ACTIVATION_STEP_INVALID': {
        const view = viewFromStepInvalid(result.details);
        if (view !== undefined && view.state !== 'STARTED' && view.state !== 'OTP_VERIFIED' && view.state !== 'PASSWORD_SET' && view.state !== 'TOTP_ISSUED') {
          this.#enter(view, undefined);
        } else {
          // The details say where the attempt is but carry no token: read GET /state for the CSRF token.
          await this.#readState(generation);
        }
        return true;
      }
      case 'ADMIN_CSRF_INVALID':
        await this.#readState(generation);
        return true;
      default:
        return false;
    }
  }

  /** After a step: GET /state and follow it, unless the step's own answer already moved the flow on. */
  async #refreshFromState(generation: number): Promise<void> {
    const result = await this.api.state();
    if (!this.#current(generation)) {
      return;
    }
    if (result.kind === 'ok') {
      this.#merge(result.data);
      return;
    }
    if (result.kind === 'error' && (result.status === 401 || result.code === 'ADMIN_ACTIVATION_SESSION_INVALID')) {
      this.#forget();
      this.#set({ name: 'session-expired' });
    }
  }

  /**
   * Keeps the screen when the server still says the same step (only refreshing attempts left / resend time and the
   * CSRF token), otherwise follows the server to the step it names.
   */
  #merge(view: ActivationView): void {
    const screen = this.#screen;
    if (view.state === 'STARTED' && screen.name === 'otp') {
      this.#remember(view);
      const resendMs = view.otp?.resendAt === undefined ? undefined : Date.parse(view.otp.resendAt);
      this.#set({
        ...screen,
        otp: view.otp,
        ...(resendMs !== undefined && Number.isFinite(resendMs) ? { resendAtMs: resendMs } : {}),
        ...(view.otp?.status === 'LOCKED' ? { codeError: 'locked' as const } : {}),
        ...(view.otp?.status === 'EXPIRED' && screen.codeError === undefined ? { codeError: 'expired' as const } : {}),
      });
      this.#armStepTimer();
      return;
    }
    if (view.state === 'TOTP_ISSUED' && screen.name === 'enroll') {
      this.#remember(view);
      this.#set({ ...screen, ...(view.totpAttemptsLeft === undefined ? {} : { attemptsLeft: view.totpAttemptsLeft }) });
      return;
    }
    if (view.state === 'OTP_VERIFIED' && screen.name === 'password') {
      this.#remember(view);
      // The read can say the password window has closed (restart_required) since the screen was built: follow it.
      const deadline = view.passwordDeadline === undefined ? undefined : Date.parse(view.passwordDeadline);
      this.#set({
        name: 'password',
        pending: screen.pending,
        restartRequired: view.restartRequired,
        ...(screen.error === undefined ? {} : { error: screen.error }),
        ...(screen.notice === undefined ? {} : { notice: screen.notice }),
        ...(screen.stateUnknown === undefined ? {} : { stateUnknown: screen.stateUnknown }),
        ...(deadline !== undefined && Number.isFinite(deadline) ? { passwordDeadlineMs: deadline } : {}),
      });
      return;
    }
    this.#enter(view, undefined);
  }

  #remember(view: ActivationView): void {
    if ('csrfToken' in view && view.csrfToken !== undefined) {
      this.#csrf = view.csrfToken;
    }
    if ('expiresAt' in view && view.expiresAt !== undefined) {
      const ms = Date.parse(view.expiresAt);
      this.#expiresAtMs = Number.isFinite(ms) ? ms : undefined;
      this.#armExpiryTimer();
    }
  }

  /** Shows the step the server named. The one place that creates step screens. */
  #enter(view: ActivationView, notice: string | undefined): void {
    const previous = this.#screen;
    this.#advance();
    this.#clearStepTimer();
    switch (view.state) {
      case 'STARTED': {
        this.#remember(view);
        const resendMs = view.otp?.resendAt === undefined ? undefined : Date.parse(view.otp.resendAt);
        const codeReset = previous.name === 'otp' ? previous.codeReset + 1 : 0;
        this.#set({
          name: 'otp',
          pending: false,
          codeReset,
          ...(view.otp === undefined ? {} : { otp: view.otp }),
          ...(resendMs !== undefined && Number.isFinite(resendMs) ? { resendAtMs: resendMs } : {}),
          ...(view.otp?.status === 'LOCKED' ? { codeError: 'locked' as const } : {}),
          ...(view.otp?.status === 'EXPIRED' ? { codeError: 'expired' as const } : {}),
          ...(notice === undefined ? {} : { notice }),
        });
        this.#armStepTimer();
        // 201 of start/restart carries only {state, csrf_token, expires_at}: the SMS status comes from a read.
        if (view.otp === undefined) {
          void this.#refreshFromState(this.#generation);
        }
        return;
      }
      case 'OTP_VERIFIED': {
        this.#remember(view);
        const deadline = view.passwordDeadline === undefined ? undefined : Date.parse(view.passwordDeadline);
        this.#set({
          name: 'password',
          pending: false,
          restartRequired: view.restartRequired,
          ...(deadline !== undefined && Number.isFinite(deadline) ? { passwordDeadlineMs: deadline } : {}),
          ...(notice === undefined ? {} : { notice }),
        });
        return;
      }
      case 'PASSWORD_SET':
      case 'TOTP_ISSUED': {
        this.#remember(view);
        this.#set({
          name: 'enroll',
          loading: false,
          showKey: false,
          pending: false,
          codeReset: previous.name === 'enroll' ? previous.codeReset + 1 : 0,
          ...(view.state === 'TOTP_ISSUED' && view.totpAttemptsLeft !== undefined ? { attemptsLeft: view.totpAttemptsLeft } : {}),
          ...(notice === undefined ? {} : { notice }),
        });
        void this.loadEnrollment();
        return;
      }
      case 'COMPLETED':
        this.#forget();
        this.#set({ name: 'done' });
        return;
      case 'INVALIDATED': {
        if ('csrfToken' in view && view.csrfToken !== undefined) {
          this.#csrf = view.csrfToken;
        } else {
          this.#csrf = undefined;
        }
        this.#clearExpiryTimer();
        this.#set({ name: 'invalidated', reason: view.reason, canRestart: view.canRestart && this.#csrf !== undefined, pending: false });
        return;
      }
    }
  }

  #armStepTimer(): void {
    this.#clearStepTimer();
    const screen = this.#screen;
    const until =
      screen.name === 'otp' ? screen.resendAtMs : screen.name === 'enroll' ? screen.lockUntilMs : screen.name === 'rate-limited' ? screen.untilMs : undefined;
    if (until === undefined) {
      return;
    }
    const delay = Math.min(TIMER_MAX_MS, Math.max(0, until - this.clock.now()));
    this.#stepTimer = this.clock.setTimeout(() => {
      this.#stepTimer = undefined;
      const current = this.#screen;
      if (current !== screen) {
        return;
      }
      // The wait is over; nothing is sent. A rate-limited start asks the person to open the link again.
      if (current.name === 'otp') {
        const { resendAtMs: _done, ...rest } = current;
        void _done;
        this.#set(rest);
      } else if (current.name === 'enroll') {
        const { lockUntilMs: _done, ...rest } = current;
        void _done;
        this.#set(rest);
      } else if (current.name === 'rate-limited') {
        this.#set({ name: 'session-expired' });
      }
    }, delay);
  }

  #clearStepTimer(): void {
    if (this.#stepTimer !== undefined) {
      this.clock.clearTimeout(this.#stepTimer);
      this.#stepTimer = undefined;
    }
  }

  #armExpiryTimer(): void {
    this.#clearExpiryTimer();
    if (this.#expiresAtMs === undefined) {
      return;
    }
    const delay = Math.min(TIMER_MAX_MS, Math.max(0, this.#expiresAtMs - this.clock.now()) + 500);
    this.#expiryTimer = this.clock.setTimeout(() => {
      this.#expiryTimer = undefined;
      const screen = this.#screen;
      if (screen.name === 'otp' || screen.name === 'password' || screen.name === 'enroll') {
        if ('pending' in screen && screen.pending) {
          this.#expiresAtMs = this.clock.now() + 1500;
          this.#armExpiryTimer();
          return;
        }
        // The attempt may have run out: ask (a read). 401 -> "phiên đã hết hạn".
        void this.#refreshFromState(this.#generation);
      }
    }, delay);
  }

  #clearExpiryTimer(): void {
    if (this.#expiryTimer !== undefined) {
      this.clock.clearTimeout(this.#expiryTimer);
      this.#expiryTimer = undefined;
    }
  }

  #forget(): void {
    this.#csrf = undefined;
    this.#expiresAtMs = undefined;
    this.#token = undefined;
    this.#clearExpiryTimer();
    this.#clearStepTimer();
  }

  #current(generation: number): boolean {
    return generation === this.#generation;
  }

  #advance(): number {
    this.#generation += 1;
    return this.#generation;
  }

  #set(screen: ActivationScreen): void {
    this.#screen = screen;
    for (const listener of this.#listeners) {
      listener(screen);
    }
  }
}
