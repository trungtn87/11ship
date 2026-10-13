import { ApiResult } from './api.js';
import { isValidPassword, isValidPhone } from './inputs.js';
import { ADMIN_COPY } from './messages.js';
import { AdminRecoveryApi, RecoveryMode } from './recovery-api.js';

// The ADMIN side of the no-OTP test password reset (page /reset, D08) as a DOM-free state machine.
//
// * The SERVER decides whether the page works: GET /config. Until a valid answer arrives the form does not exist ('loading'), and a
//   mode that is not DISABLED_TEST (or a failed read, with "Thử lại") never lets anything be sent. Nothing is guessed.
// * One form: phone, new password, confirmation (checked by the page only, never sent). No code step, no auto login.
// * One intent = one Idempotency-Key + body. A lost / unknown answer keeps both: submitting the same form again re-sends the SAME
//   request. A different phone or password starts a new intent. Nothing is repeated automatically.
// * The answer is the same for every phone, so 'done' only says the request was processed.
// * The password is never stored here beyond the kept intent, which is dropped when the answer is final or the page is left.

export type ResetFailure = 'invalid' | 'unavailable' | 'rate-limited' | 'unknown-outcome';

export type RecoveryScreen =
  | { readonly name: 'loading' }
  | { readonly name: 'config-error' }
  | { readonly name: 'unavailable' }
  | { readonly name: 'test-form'; readonly phone: string; readonly phoneError?: string; readonly passwordError?: string; readonly failure?: ResetFailure; readonly retrySec?: number; readonly pending: boolean }
  | { readonly name: 'done' };

export type RecoveryListener = (screen: RecoveryScreen) => void;

interface Intent {
  readonly phone: string;
  readonly password: string;
  readonly key: string;
}

export class RecoveryController {
  #screen: RecoveryScreen = { name: 'loading' };
  #mode: RecoveryMode | undefined;
  #intent: Intent | undefined;
  #running = false;
  readonly #listeners = new Set<RecoveryListener>();

  constructor(
    private readonly api: AdminRecoveryApi,
    private readonly newKey: () => string,
  ) {}

  get screen(): RecoveryScreen {
    return this.#screen;
  }

  subscribe(listener: RecoveryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the server's mode. Safe to call again ("Thử lại"). */
  async start(): Promise<void> {
    this.#mode = undefined;
    this.#set({ name: 'loading' });
    const result = await this.api.config();
    if (result.kind !== 'ok') {
      this.#set({ name: 'config-error' });
      return;
    }
    this.#mode = result.data;
    this.#set(result.data === 'DISABLED_TEST' ? { name: 'test-form', phone: '', pending: false } : { name: 'unavailable' });
  }

  async submit(phoneInput: string, password: string, confirmation: string): Promise<void> {
    const current = this.#screen;
    if (this.#mode !== 'DISABLED_TEST' || current.name !== 'test-form' || this.#running) {
      return;
    }
    const phone = phoneInput.trim();
    const phoneError = isValidPhone(phone) ? undefined : 'Số điện thoại không hợp lệ.';
    const passwordError = !isValidPassword(password) ? ADMIN_COPY.passwordInvalid : password !== confirmation ? ADMIN_COPY.passwordMismatch : undefined;
    if (phoneError !== undefined || passwordError !== undefined) {
      this.#set({ name: 'test-form', phone, pending: false, ...(phoneError === undefined ? {} : { phoneError }), ...(passwordError === undefined ? {} : { passwordError }) });
      return;
    }
    const kept = this.#intent;
    const intent: Intent = kept !== undefined && kept.phone === phone && kept.password === password ? kept : { phone, password, key: this.newKey() };
    this.#intent = intent;
    this.#running = true;
    this.#set({ name: 'test-form', phone, pending: true });
    let result: ApiResult<'LOGIN'>;
    try {
      result = await this.api.reset(intent.phone, intent.password, intent.key);
    } finally {
      this.#running = false;
    }
    if (this.#screen.name !== 'test-form') {
      return; // the page was left while the request ran
    }
    if (result.kind === 'ok') {
      this.#intent = undefined;
      this.#set({ name: 'done' });
      return;
    }
    if (result.kind === 'network' || result.status >= 500 || result.code === 'IDEMPOTENCY_BUSY' || result.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
      // The server may or may not have done it: the intent (key + body) stays, "Thử lại" re-sends the SAME request.
      this.#set({ name: 'test-form', phone, pending: false, failure: result.kind === 'error' && result.status === 503 && result.code === 'SERVICE_UNAVAILABLE' ? 'unavailable' : 'unknown-outcome' });
      return;
    }
    this.#intent = undefined;
    if (result.status === 429) {
      this.#set({ name: 'test-form', phone, pending: false, failure: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retrySec: result.retryAfterSeconds }) });
      return;
    }
    this.#set({ name: 'test-form', phone, pending: false, failure: 'invalid' });
  }

  /** The page is left: what was kept (it holds the new password) is dropped. */
  leave(): void {
    this.#intent = undefined;
  }

  #set(screen: RecoveryScreen): void {
    this.#screen = screen;
    for (const listener of this.#listeners) {
      listener(screen);
    }
  }
}
