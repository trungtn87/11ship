import { ActivationOtpDelivery, ActivationOtpProvider } from '../admin-activation/activation-otp-provider';
import { OtpProvider } from '../auth/otp-provider';
import { TestSmsInbox } from './test-sms-inbox';

// The two delivery adapters of the test inbox (M01.22). Both only APPEND to the one shared inbox; neither generates,
// verifies, resends or consumes a code, and neither writes the OTP or the phone anywhere else. They are bound only
// when TEST_INBOX is selected explicitly in a local development/test environment (see test-sms-config.ts).
//
// RESET_PASSWORD has NO adapter here: it is wired by M01.16 through its own port.

/**
 * REGISTER. The port contract resolves only after the provider accepted the message, so this resolves only after the
 * append succeeded; an append that throws becomes a rejection, which Auth turns into its sanitized 503.
 */
export class TestInboxOtpProvider implements OtpProvider {
  readonly #inbox: TestSmsInbox;

  constructor(inbox: TestSmsInbox) {
    this.#inbox = inbox;
  }

  async sendRegisterOtp(phoneNormalized: string, otp: string): Promise<void> {
    this.#inbox.append({ purpose: 'REGISTER', phoneNormalized, otp });
  }
}

/**
 * ADMIN_ACTIVATION. ACCEPTED only after the append succeeded, and NEVER a displayedCode: the public activation response
 * carries no code in this mode. An append that throws rejects, which the activation service maps to UNKNOWN exactly as
 * it does for any provider exception (the outcome is not coerced here; the core challenge stays the authority).
 */
export class TestInboxActivationOtpProvider implements ActivationOtpProvider {
  readonly mode = 'TEST_INBOX' as const;
  readonly #inbox: TestSmsInbox;

  constructor(inbox: TestSmsInbox) {
    this.#inbox = inbox;
  }

  async send(phoneNormalized: string, otp: string): Promise<ActivationOtpDelivery> {
    this.#inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized, otp });
    return { outcome: 'ACCEPTED' };
  }
}
