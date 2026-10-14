import { ApiResult } from './api.js';
import { isValidPassword, isValidPhone } from './inputs.js';
import { ADMIN_COPY } from './messages.js';
import { AdminRecoveryApi, RecoveryMode } from './recovery-api.js';

// The ADMIN side of the SMS-verified password reset (page /reset, D08) as a DOM-free state machine.
//
// * The SERVER decides whether the page works: GET /config. Until a valid answer arrives the page shows 'loading'; a mode that is not
//   SMS_OTP (or a failed read, with "Thử lại") never lets anything be sent. Nothing is guessed, no bypass exists.
// * Steps: phone -> SMS code -> new password. The code request answers the same for every number, so the page only says "if the number
//   belongs to an account you will receive a code". The proof is one-use and kept in memory only.
// * One reset intent = one Idempotency-Key + body (proof, password). A lost answer keeps both; the same form re-sends the SAME request.
// * The answer is the same for every phone, so 'done' only says the request was processed. The TOTP factor is untouched.
// * The code, the password and the proof are never kept beyond the step that needs them and are dropped when the page is left.

export type CodeError = 'invalid' | 'expired' | 'locked' | 'unavailable';

export type RecoveryScreen =
  | { readonly name: 'loading' }
  | { readonly name: 'config-error' }
  | { readonly name: 'unavailable' }
  | { readonly name: 'phone'; readonly phone: string; readonly phoneError?: string; readonly pending: boolean }
  | { readonly name: 'otp'; readonly phoneMasked: string; readonly codeError?: CodeError; readonly resendSec?: number; readonly pending: boolean }
  | { readonly name: 'password'; readonly error?: string; readonly pending: boolean }
  | { readonly name: 'done' }
  | { readonly name: 'rate-limited'; readonly retrySec: number };

export type RecoveryListener = (screen: RecoveryScreen) => void;

interface Intent {
  readonly proof: string;
  readonly password: string;
  readonly key: string;
}

const SEND_FAILED = 'Chưa gửi được mã. Vui lòng thử lại sau.';

export class RecoveryController {
  #screen: RecoveryScreen = { name: 'loading' };
  #mode: RecoveryMode | undefined;
  #phone = '';
  #verificationId: string | undefined;
  #proof: string | undefined;
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
    this.#drop();
    this.#mode = undefined;
    this.#set({ name: 'loading' });
    const result = await this.api.config();
    if (result.kind !== 'ok') {
      this.#set({ name: 'config-error' });
      return;
    }
    this.#mode = result.data;
    this.#set(result.data === 'SMS_OTP' ? { name: 'phone', phone: '', pending: false } : { name: 'unavailable' });
  }

  /** Step 1 (and "Gửi lại mã"): ask for a code for this number. */
  async sendCode(phoneInput: string): Promise<void> {
    const phone = phoneInput.trim();
    if (this.#mode !== 'SMS_OTP' || this.#running || (this.#screen.name !== 'phone' && this.#screen.name !== 'otp')) {
      return;
    }
    if (!isValidPhone(phone)) {
      this.#set({ name: 'phone', phone, pending: false, phoneError: 'Số điện thoại không hợp lệ.' });
      return;
    }
    const fromOtp = this.#screen.name === 'otp';
    this.#running = true;
    this.#set(fromOtp ? { name: 'otp', phoneMasked: mask(phone), pending: true } : { name: 'phone', phone, pending: true });
    let result: Awaited<ReturnType<AdminRecoveryApi['requestOtp']>>;
    try {
      result = await this.api.requestOtp(phone);
    } finally {
      this.#running = false;
    }
    if (this.#screen.name !== 'phone' && this.#screen.name !== 'otp') {
      return; // the page was left
    }
    if (result.kind === 'ok') {
      this.#phone = phone;
      this.#verificationId = result.data.verificationId;
      this.#proof = undefined;
      this.#set({ name: 'otp', phoneMasked: mask(phone), pending: false, resendSec: result.data.resendAfterSeconds });
      return;
    }
    if (result.kind === 'error' && result.status === 429) {
      this.#set({ name: 'rate-limited', retrySec: result.retryAfterSeconds ?? 60 });
      return;
    }
    // 503 (gateway not ready) and a lost answer are told honestly: nothing was sent that the page knows of.
    this.#set(fromOtp ? { name: 'otp', phoneMasked: mask(phone), pending: false, codeError: 'unavailable' } : { name: 'phone', phone, pending: false, phoneError: SEND_FAILED });
  }

  /** "Gửi lại mã": the same number as the code on screen. */
  async resend(): Promise<void> {
    await this.sendCode(this.#phone);
  }

  /** Step 2: the 6-digit code. A wrong code can be tried again on the same challenge (the server counts and locks). */
  async verify(code: string): Promise<void> {
    const id = this.#verificationId;
    const screen = this.#screen;
    if (this.#mode !== 'SMS_OTP' || this.#running || screen.name !== 'otp' || id === undefined) {
      return;
    }
    this.#running = true;
    this.#set({ name: 'otp', phoneMasked: screen.phoneMasked, pending: true });
    let result: ApiResult<string>;
    try {
      result = await this.api.verifyOtp(id, code);
    } finally {
      this.#running = false;
    }
    if (this.#screen.name !== 'otp') {
      return;
    }
    if (result.kind === 'ok') {
      this.#proof = result.data;
      this.#set({ name: 'password', pending: false });
      return;
    }
    const codeError: CodeError =
      result.kind === 'error' && result.code === 'OTP_INVALID'
        ? 'invalid'
        : result.kind === 'error' && result.code === 'OTP_EXPIRED'
          ? 'expired'
          : result.kind === 'error' && result.code === 'OTP_RATE_LIMITED'
            ? 'locked'
            : 'unavailable';
    this.#set({ name: 'otp', phoneMasked: screen.phoneMasked, pending: false, codeError });
  }

  /** Step 3: the new password (confirmation is checked by the page). Same proof + password = the same key. */
  async setPassword(password: string): Promise<void> {
    const proof = this.#proof;
    if (this.#mode !== 'SMS_OTP' || this.#running || this.#screen.name !== 'password' || proof === undefined) {
      return;
    }
    if (!isValidPassword(password)) {
      this.#set({ name: 'password', pending: false, error: ADMIN_COPY.passwordInvalid });
      return;
    }
    const kept = this.#intent;
    const intent: Intent = kept !== undefined && kept.proof === proof && kept.password === password ? kept : { proof, password, key: this.newKey() };
    this.#intent = intent;
    this.#running = true;
    this.#set({ name: 'password', pending: true });
    let result: ApiResult<'LOGIN'>;
    try {
      result = await this.api.reset(intent.proof, intent.password, intent.key);
    } finally {
      this.#running = false;
    }
    if (this.#screen.name !== 'password') {
      return;
    }
    if (result.kind === 'ok') {
      this.#drop();
      this.#set({ name: 'done' });
      return;
    }
    if (result.kind === 'network' || result.status >= 500 || result.code === 'IDEMPOTENCY_BUSY' || result.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
      // The server may or may not have done it: key + body stay, the same form re-sends the SAME request.
      this.#set({ name: 'password', pending: false, error: 'Chưa biết yêu cầu đã được xử lý hay chưa. Bấm “Đặt lại mật khẩu” để gửi lại đúng yêu cầu trước.' });
      return;
    }
    if (result.status === 429) {
      this.#drop();
      this.#set({ name: 'rate-limited', retrySec: result.retryAfterSeconds ?? 60 });
      return;
    }
    // A refused / spent / expired proof: it can not be reused, the person asks for a new code.
    this.#drop();
    this.#set({ name: 'phone', phone: this.#phone, pending: false, phoneError: 'Mã xác minh không còn hiệu lực. Vui lòng gửi lại mã mới.' });
  }

  /** The page is left: what was kept (it holds the proof and the new password) is dropped. */
  leave(): void {
    this.#drop();
  }

  #drop(): void {
    this.#intent = undefined;
    this.#proof = undefined;
    this.#verificationId = undefined;
  }

  #set(screen: RecoveryScreen): void {
    this.#screen = screen;
    for (const listener of this.#listeners) {
      listener(screen);
    }
  }
}

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '••••' : `${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}
