import { AdminActivationConfig } from '../config/admin-activation-config';
import { StartupConfigError } from '../config/startup-config-error';
import { ActivationOtpDelivery, ActivationOtpProvider } from './activation-otp-provider';

// In-memory providers for a development or test environment ONLY. Neither writes the OTP or the phone to any log or
// stream. They exist so the activation can be exercised end to end before a real SMS adapter exists.

export interface SentActivationOtp {
  readonly phoneNormalized: string;
  readonly otp: string;
}

/** FAKE mode: keeps what it "sent" in memory so a test can read the OTP; scripted outcomes and a deterministic barrier. */
export class FakeActivationOtpProvider implements ActivationOtpProvider {
  readonly mode = 'FAKE' as const;
  readonly #sent: SentActivationOtp[] = [];
  readonly #script: ('REJECTED' | 'UNKNOWN' | 'THROW')[] = [];
  #started = 0;
  #barrier: Promise<void> | undefined;

  async send(phoneNormalized: string, otp: string): Promise<ActivationOtpDelivery> {
    this.#started += 1;
    if (this.#barrier !== undefined) {
      await this.#barrier;
    }
    const next = this.#script.shift();
    if (next === 'THROW') {
      throw new Error('fake provider failure');
    }
    if (next === 'REJECTED') {
      return { outcome: 'REJECTED' };
    }
    // An UNKNOWN answer may still have reached the phone, so the code is recorded like an accepted one.
    this.#sent.push({ phoneNormalized, otp });
    return { outcome: next === 'UNKNOWN' ? 'UNKNOWN' : 'ACCEPTED' };
  }

  /** The next sends answer these outcomes, in order. REJECTED: not sent. UNKNOWN: sent but unknown. THROW: exception. */
  script(...outcomes: ('REJECTED' | 'UNKNOWN' | 'THROW')[]): void {
    this.#script.push(...outcomes);
  }

  holdSends(): () => void {
    let release!: () => void;
    this.#barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.#barrier = undefined;
      release();
    };
  }

  sendStarted(): number {
    return this.#started;
  }

  sentCount(): number {
    return this.#sent.length;
  }

  lastOtpFor(phoneNormalized: string): string | undefined {
    for (let index = this.#sent.length - 1; index >= 0; index -= 1) {
      const entry = this.#sent[index];
      if (entry !== undefined && entry.phoneNormalized === phoneNormalized) {
        return entry.otp;
      }
    }
    return undefined;
  }

  clear(): void {
    this.#sent.length = 0;
    this.#script.length = 0;
    this.#started = 0;
  }
}

/** TEST_DISPLAY mode: "delivers" by handing the code back to the client. Test environments only; keeps nothing. */
export class TestDisplayActivationOtpProvider implements ActivationOtpProvider {
  readonly mode = 'TEST_DISPLAY' as const;

  send(_phoneNormalized: string, otp: string): Promise<ActivationOtpDelivery> {
    return Promise.resolve({ outcome: 'ACCEPTED', displayedCode: otp });
  }
}

/**
 * The provider main.ts binds. FAKE / TEST_DISPLAY come only from an explicit ADMIN_ACTIVATION_OTP_MODE in a non-production
 * environment (the configuration loader already refused them elsewhere). SMS has no provider yet: startup is refused,
 * naming only the variable, so there is no silent fallback to a test provider.
 */
export function bindActivationOtpProvider(
  config: AdminActivationConfig,
  options: { readonly testInboxProvider?: ActivationOtpProvider } = {},
): ActivationOtpProvider {
  if (config.otpMode === 'FAKE') {
    return new FakeActivationOtpProvider();
  }
  if (config.otpMode === 'TEST_DISPLAY') {
    return new TestDisplayActivationOtpProvider();
  }
  // TEST_INBOX (M01.22): only with the adapter main.ts built after the explicit selection was accepted.
  if (config.otpMode === 'TEST_INBOX' && options.testInboxProvider !== undefined) {
    return options.testInboxProvider;
  }
  throw new StartupConfigError(['ADMIN_ACTIVATION_OTP_MODE']);
}
