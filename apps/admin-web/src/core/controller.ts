import { AdminAuthApi, AdminRole, ApiResult, NextStep, StateData } from './api.js';
import { COPY } from './messages.js';
import { isCompleteCode, isValidPhone } from './inputs.js';

// The administration login flow as a small state machine, free of DOM so it can be unit tested in Node.
//
// Rules taken from the UI handoff (2026-10-09):
//  * The server decides everything (state, next step, role, expiry); nothing here grants anything by itself. No screen
//    after the password step is reachable without a server answer saying so, and the shell is shown only after GET /me.
//  * Credentials are the backend's HttpOnly cookies. The CSRF token, the enrollment secret and the otpauth URI live only
//    in this object's memory and are dropped as soon as they are not needed. The password is never kept.
//  * No request is ever repeated automatically (no retry loop, no re-submitted code, no submit when a countdown ends).
//    The only automatic calls are READS of GET /state and GET /me, to learn what the server already decided.

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LockInfo {
  /** Epoch ms when the server said a new attempt may be made (from Retry-After). */
  readonly untilMs: number;
}

export type Screen =
  | { readonly name: 'checking' }
  | { readonly name: 'unavailable'; readonly pending: boolean }
  | {
      readonly name: 'login';
      readonly phone: string;
      readonly phoneError?: string;
      readonly formError?: string;
      readonly notice?: string;
      readonly pending: boolean;
      readonly lock?: LockInfo;
    }
  | {
      readonly name: 'enroll';
      readonly secret?: string;
      readonly otpauthUri?: string;
      readonly loadingSecret: boolean;
      readonly secretError?: string;
      readonly showKey: boolean;
      readonly codeError?: string;
      readonly notice?: string;
      readonly pending: boolean;
      readonly lock?: LockInfo;
      /** Bumped whenever the code field must be emptied (wrong code, step changed). */
      readonly codeReset: number;
    }
  | {
      readonly name: 'verify';
      readonly codeError?: string;
      readonly notice?: string;
      readonly pending: boolean;
      readonly lock?: LockInfo;
      readonly codeReset: number;
    }
  | {
      readonly name: 'shell';
      readonly role: AdminRole;
      readonly error?: string;
      readonly notice?: string;
      readonly pending: boolean;
    };

type Listener = (screen: Screen) => void;

/** Server-issued values kept in memory only. */
interface Memory {
  csrf?: string;
  expiresAtMs?: number;
}

const TIMER_MAX_MS = 2_147_000_000;

export class AdminAuthController {
  #screen: Screen = { name: 'checking' };
  #memory: Memory = {};
  #listeners = new Set<Listener>();
  /** Incremented whenever the flow moves on; a result that belongs to an older generation is ignored. */
  #generation = 0;
  #lastPhone = '';
  #expiryTimer: unknown;
  #lockTimer: unknown;
  #busyReading = false;

  constructor(
    private readonly api: AdminAuthApi,
    private readonly clock: Clock,
    private readonly deviceId: () => string,
  ) {}

  get screen(): Screen {
    return this.#screen;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Remaining whole seconds of the current lock, 0 when there is none. */
  lockRemainingSeconds(): number {
    const lock = 'lock' in this.#screen ? this.#screen.lock : undefined;
    if (lock === undefined) {
      return 0;
    }
    return Math.max(0, Math.ceil((lock.untilMs - this.clock.now()) / 1000));
  }

  /** Page open or reload: ask the server where this browser stands. Neutral "checking" until it answers. */
  async start(): Promise<void> {
    const generation = this.#advance();
    this.#set({ name: 'checking' });
    await this.#readState(generation, undefined);
  }

  /** The "Thử lại" button of the unavailable screen. */
  async retryStart(): Promise<void> {
    if (this.#screen.name !== 'unavailable' || this.#screen.pending) {
      return;
    }
    const generation = this.#advance();
    this.#set({ name: 'unavailable', pending: true });
    await this.#readState(generation, undefined);
  }

  async submitLogin(phone: string, password: string): Promise<'sent' | 'invalid-phone' | 'missing-password' | 'ignored'> {
    const screen = this.#screen;
    if (screen.name !== 'login' || screen.pending || this.#locked(screen.lock)) {
      return 'ignored';
    }
    this.#lastPhone = phone;
    if (!isValidPhone(phone)) {
      this.#set({ name: 'login', phone, phoneError: COPY.invalidPhone, pending: false });
      return 'invalid-phone';
    }
    if (password === '') {
      this.#set({ name: 'login', phone, pending: false });
      return 'missing-password';
    }
    const generation = this.#advance();
    this.#set({ name: 'login', phone, pending: true });
    const result = await this.api.login(phone.trim(), password, this.deviceId());
    if (generation !== this.#generation) {
      return 'sent';
    }
    if (result.kind === 'ok') {
      this.#remember(result.data.csrfToken, result.data.expiresAt);
      this.#enterStep(result.data.nextStep, undefined);
      return 'sent';
    }
    if (result.kind === 'error' && result.code === 'INVALID_PHONE') {
      this.#set({ name: 'login', phone, phoneError: COPY.invalidPhone, pending: false });
    } else if (result.kind === 'error' && result.code === 'INVALID_CREDENTIALS') {
      this.#set({ name: 'login', phone, formError: COPY.invalidCredentials, pending: false });
    } else if (result.kind === 'error' && result.code === 'ADMIN_AUTH_RATE_LIMITED') {
      this.#set({ name: 'login', phone, pending: false, lock: this.#lockFrom(result) });
    } else {
      this.#set({ name: 'login', phone, formError: COPY.unavailable, pending: false });
    }
    return 'sent';
  }

  /** Enrollment secret and QR: loaded on entering the step and on the explicit retry button only. */
  async loadEnrollment(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'enroll' || screen.loadingSecret || this.#locked(screen.lock) || this.#memory.csrf === undefined) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, loadingSecret: true, secretError: undefined, lock: undefined });
    const result = await this.api.startEnrollment(this.#memory.csrf);
    if (generation !== this.#generation || this.#screen.name !== 'enroll') {
      return;
    }
    const current = this.#screen;
    if (result.kind === 'ok') {
      this.#remember(this.#memory.csrf, result.data.expiresAt);
      this.#set({ ...current, loadingSecret: false, secret: result.data.secret, otpauthUri: result.data.otpauthUri });
      return;
    }
    if (result.kind === 'error') {
      if (result.code === 'ADMIN_PREAUTH_INVALID') {
        this.#toLogin(COPY.preauthInvalid);
        return;
      }
      if (result.code === 'ADMIN_CSRF_INVALID' || result.code === 'ADMIN_ENROLLMENT_NOT_ALLOWED') {
        await this.#resync();
        return;
      }
      if (result.code === 'ADMIN_AUTH_RATE_LIMITED') {
        this.#set({ ...current, loadingSecret: false, lock: this.#lockFrom(result) });
        return;
      }
    }
    this.#set({ ...current, loadingSecret: false, secretError: COPY.unavailable });
  }

  toggleKey(): void {
    if (this.#screen.name === 'enroll') {
      this.#set({ ...this.#screen, showKey: !this.#screen.showKey });
    }
  }

  async submitCode(code: string): Promise<'sent' | 'incomplete' | 'ignored'> {
    const screen = this.#screen;
    if ((screen.name !== 'enroll' && screen.name !== 'verify') || screen.pending || this.#locked(screen.lock)) {
      return 'ignored';
    }
    if (screen.name === 'enroll' && screen.secret === undefined) {
      return 'ignored';
    }
    if (!isCompleteCode(code)) {
      return 'incomplete';
    }
    const csrf = this.#memory.csrf;
    if (csrf === undefined) {
      return 'ignored';
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, codeError: undefined, notice: undefined, lock: undefined });
    const result = screen.name === 'enroll' ? await this.api.completeEnrollment(csrf, code) : await this.api.verify(csrf, code);
    if (generation !== this.#generation) {
      return 'sent';
    }
    const current = this.#screen;
    if (current.name !== 'enroll' && current.name !== 'verify') {
      return 'sent';
    }
    if (result.kind === 'ok') {
      // The step is over: the preauth CSRF token, the secret and the URI are dropped before anything else happens.
      this.#forget();
      await this.#enterSession(this.#advance(), undefined);
      return 'sent';
    }
    if (result.kind === 'network') {
      await this.#afterLostResponse(generation);
      return 'sent';
    }
    switch (result.code) {
      case 'ADMIN_TOTP_INVALID':
        this.#set({ ...current, pending: false, codeError: COPY.totpInvalid, codeReset: current.codeReset + 1 });
        break;
      case 'ADMIN_PREAUTH_INVALID':
        this.#toLogin(COPY.preauthInvalid);
        break;
      case 'ADMIN_CSRF_INVALID':
        await this.#resync();
        break;
      case 'ADMIN_AUTH_RATE_LIMITED':
        this.#set({ ...current, pending: false, lock: this.#lockFrom(result) });
        break;
      default:
        this.#set({ ...current, pending: false, codeError: COPY.unavailable });
    }
    return 'sent';
  }

  /** "Quay lại đăng nhập": drop everything of the step. The next login supersedes it on the server. */
  backToLogin(): void {
    if (this.#screen.name === 'enroll' || this.#screen.name === 'verify') {
      this.#toLogin(undefined);
    }
  }

  async logout(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'shell' || screen.pending || this.#memory.csrf === undefined) {
      return;
    }
    const generation = this.#generation;
    this.#set({ ...screen, pending: true, error: undefined, notice: undefined });
    const result = await this.api.logout(this.#memory.csrf);
    if (generation !== this.#generation || this.#screen.name !== 'shell') {
      return;
    }
    if (result.kind === 'ok' || (result.kind === 'error' && result.code === 'ADMIN_SESSION_INVALID')) {
      this.#toLogin(undefined);
      return;
    }
    if (result.kind === 'error' && result.code === 'ADMIN_CSRF_INVALID') {
      await this.#resync();
      return;
    }
    // Not logged out: a lost or failed request is never assumed to have worked.
    this.#set({ ...this.#screen, pending: false, error: COPY.unavailable });
  }

  /**
   * The tab became visible again (another tab may have logged in, out or started a new step). Reads GET /state and
   * follows it; the state of the server is the truth. Never runs while a request of this tab is pending.
   */
  async recheck(): Promise<void> {
    const screen = this.#screen;
    if (screen.name === 'checking' || screen.name === 'unavailable' || screen.pending || this.#busyReading) {
      return;
    }
    if ((screen.name === 'enroll' && screen.loadingSecret) || this.#lockTimer !== undefined) {
      return;
    }
    const generation = this.#generation;
    this.#busyReading = true;
    let result: ApiResult<StateData>;
    try {
      result = await this.api.state();
    } finally {
      this.#busyReading = false;
    }
    if (generation !== this.#generation || this.#screen !== screen) {
      return;
    }
    if (result.kind === 'network' || (result.kind === 'error' && result.status >= 500)) {
      return;
    }
    if (result.kind === 'error') {
      if (screen.name === 'shell') {
        this.#toLogin(undefined);
      } else if (screen.name === 'enroll' || screen.name === 'verify') {
        this.#toLogin(COPY.preauthInvalid);
      }
      return;
    }
    const state = result.data;
    if (state.state === 'SESSION') {
      if (screen.name === 'shell' && state.csrfToken === this.#memory.csrf) {
        return;
      }
      // Another tab completed a login (possibly as someone else): the role is read again from GET /me.
      this.#forget();
      await this.#enterSession(this.#advance(), undefined);
      return;
    }
    if (screen.name === 'shell' || screen.name === 'login') {
      if (screen.name === 'shell') {
        // Our session is gone but a step exists (another tab logged in with the password): follow the server.
        this.#remember(state.csrfToken, state.expiresAt);
        this.#enterStep(state.nextStep, COPY.stepChanged);
      }
      return;
    }
    const sameStep = (screen.name === 'enroll') === (state.nextStep === 'ENROLL_TOTP');
    if (sameStep && state.csrfToken === this.#memory.csrf) {
      return;
    }
    this.#remember(state.csrfToken, state.expiresAt);
    this.#enterStep(state.nextStep, COPY.stepChanged);
  }

  // ---- internals ----

  #advance(): number {
    this.#generation += 1;
    return this.#generation;
  }

  #set(screen: Screen): void {
    this.#screen = screen;
    this.#armLockTimer(screen);
    for (const listener of this.#listeners) {
      listener(screen);
    }
  }

  #locked(lock: LockInfo | undefined): boolean {
    return lock !== undefined && lock.untilMs > this.clock.now();
  }

  #lockFrom(result: { retryAfterSeconds?: number }): LockInfo {
    // Retry-After is always sent with this code; if a proxy dropped it, one minute keeps the button from inviting an
    // immediate retry. The backend stays the authority either way.
    const seconds = result.retryAfterSeconds ?? 60;
    return { untilMs: this.clock.now() + seconds * 1000 };
  }

  /** When the countdown ends the screen is re-emitted so the button becomes usable again. Nothing is submitted. */
  #armLockTimer(screen: Screen): void {
    if (this.#lockTimer !== undefined) {
      this.clock.clearTimeout(this.#lockTimer);
      this.#lockTimer = undefined;
    }
    const lock = 'lock' in screen ? screen.lock : undefined;
    if (lock === undefined) {
      return;
    }
    const delay = Math.min(TIMER_MAX_MS, Math.max(0, lock.untilMs - this.clock.now()));
    this.#lockTimer = this.clock.setTimeout(() => {
      this.#lockTimer = undefined;
      if (this.#screen === screen) {
        const { lock: _ended, ...rest } = screen as Screen & { lock?: LockInfo };
        void _ended;
        this.#set({ ...rest, notice: COPY.rateLimitedOver } as Screen);
      }
    }, delay);
  }

  #remember(csrf: string, expiresAt: string): void {
    const expiresAtMs = Date.parse(expiresAt);
    this.#memory = { csrf, expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : undefined };
    this.#armExpiryTimer();
  }

  #forget(): void {
    this.#memory = {};
    if (this.#expiryTimer !== undefined) {
      this.clock.clearTimeout(this.#expiryTimer);
      this.#expiryTimer = undefined;
    }
  }

  /** At the server's expiry time the state is read again (a step then answers 401 and the user is sent to login). */
  #armExpiryTimer(): void {
    if (this.#expiryTimer !== undefined) {
      this.clock.clearTimeout(this.#expiryTimer);
      this.#expiryTimer = undefined;
    }
    const expiresAtMs = this.#memory.expiresAtMs;
    if (expiresAtMs === undefined) {
      return;
    }
    const delay = Math.min(TIMER_MAX_MS, Math.max(0, expiresAtMs - this.clock.now()) + 500);
    this.#expiryTimer = this.clock.setTimeout(() => {
      this.#expiryTimer = undefined;
      void this.#onExpiry();
    }, delay);
  }

  async #onExpiry(): Promise<void> {
    const screen = this.#screen;
    if (screen.name !== 'enroll' && screen.name !== 'verify' && screen.name !== 'shell') {
      return;
    }
    if (screen.pending) {
      // The answer of the pending request decides; check again shortly after it.
      this.#expiryTimer = this.clock.setTimeout(() => {
        this.#expiryTimer = undefined;
        void this.#onExpiry();
      }, 2000);
      return;
    }
    const generation = this.#generation;
    const result = await this.api.state();
    if (generation !== this.#generation || this.#screen !== screen) {
      return;
    }
    if (result.kind === 'error' && result.status === 401) {
      this.#toLogin(screen.name === 'shell' ? undefined : COPY.preauthExpired);
      return;
    }
    if (result.kind === 'ok') {
      await this.recheck();
    }
  }

  #toLogin(notice: string | undefined): void {
    this.#forget();
    this.#advance();
    this.#set({ name: 'login', phone: this.#lastPhone, pending: false, ...(notice === undefined ? {} : { notice }) });
  }

  #enterStep(step: NextStep, notice: string | undefined): void {
    this.#advance();
    // Re-entering the same kind of step (the step changed under this tab) empties the code field as well.
    const previous = this.#screen;
    const codeReset = previous.name === 'enroll' || previous.name === 'verify' ? previous.codeReset + 1 : 0;
    if (step === 'ENROLL_TOTP') {
      this.#set({ name: 'enroll', loadingSecret: false, showKey: false, pending: false, codeReset, ...(notice === undefined ? {} : { notice }) });
      void this.loadEnrollment();
    } else {
      this.#set({ name: 'verify', pending: false, codeReset, ...(notice === undefined ? {} : { notice }) });
    }
  }

  /** The shell is entered only with GET /me: the role shown comes from it, never from a previous answer or the client. */
  async #enterSession(generation: number, notice: string | undefined): Promise<void> {
    const me = await this.api.me();
    if (generation !== this.#generation) {
      return;
    }
    if (me.kind === 'ok') {
      this.#remember(me.data.csrfToken, me.data.expiresAt);
      this.#set({ name: 'shell', role: me.data.adminRole, pending: false, ...(notice === undefined ? {} : { notice }) });
      return;
    }
    if (me.kind === 'error' && me.status === 401) {
      this.#toLogin(undefined);
      return;
    }
    this.#forget();
    this.#set({ name: 'unavailable', pending: false });
  }

  /** GET /state and follow it. `notice` is shown on the resulting screen (also on login when nothing is left). */
  async #readState(generation: number, notice: string | undefined): Promise<void> {
    const result = await this.api.state();
    if (generation !== this.#generation) {
      return;
    }
    if (result.kind === 'ok') {
      const state = result.data;
      if (state.state === 'SESSION') {
        await this.#enterSession(generation, notice);
        return;
      }
      this.#remember(state.csrfToken, state.expiresAt);
      this.#enterStep(state.nextStep, notice);
      return;
    }
    if (result.kind === 'error' && result.status === 401) {
      // No session and no step. A dead step cookie gets the "log in again" notice; no cookie at all is a plain login.
      this.#toLogin(result.code === 'ADMIN_PREAUTH_INVALID' ? COPY.preauthInvalid : notice);
      return;
    }
    this.#forget();
    this.#set({ name: 'unavailable', pending: false });
  }

  /** ADMIN_CSRF_INVALID and friends: never repeat the mutation; read the state, follow it, and say the step changed. */
  async #resync(): Promise<void> {
    const generation = this.#advance();
    this.#forget();
    await this.#readState(generation, COPY.stepChanged);
  }

  /**
   * The code was sent but no answer came back. The server may have committed (session cookie set) or not. Only a READ
   * is made: SESSION -> shell; the same step still alive -> stay, the user decides; no step and no session -> login with
   * the instruction to use a new code. The code is never sent again automatically.
   */
  async #afterLostResponse(generation: number): Promise<void> {
    const result = await this.api.state();
    if (generation !== this.#generation) {
      return;
    }
    const current = this.#screen;
    if (current.name !== 'enroll' && current.name !== 'verify') {
      return;
    }
    if (result.kind === 'ok' && result.data.state === 'SESSION') {
      this.#forget();
      await this.#enterSession(this.#advance(), undefined);
      return;
    }
    if (result.kind === 'ok') {
      this.#remember(result.data.csrfToken, result.data.expiresAt);
      this.#set({ ...current, pending: false, codeError: COPY.unavailable });
      return;
    }
    if (result.kind === 'error' && result.status === 401) {
      this.#toLogin(COPY.lostResponse);
      return;
    }
    this.#set({ ...current, pending: false, codeError: COPY.unavailable });
  }
}
