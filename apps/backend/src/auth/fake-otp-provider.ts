import { OtpProvider } from './otp-provider';

// Fake OTP provider for development and automated tests ONLY (M01-A1 task section 7). main.ts refuses to bind
// it in staging and production. It keeps what it "sent" in memory so a test can read the OTP, and it NEVER
// writes the OTP (or the phone number) to any log or stream.
//
// Test controls:
//  - failNext(n): the next n sends reject;
//  - holdSends(): sends wait until the returned release function is called (a deterministic barrier for
//    concurrency tests that need the provider call to be "in flight");
//  - sendStarted(): the number of send calls that have begun, to know a call is waiting at the barrier.

export interface SentOtp {
  readonly phoneNormalized: string;
  readonly otp: string;
}

export class FakeOtpProvider implements OtpProvider {
  readonly #sent: SentOtp[] = [];
  #failuresLeft = 0;
  #started = 0;
  #barrier: Promise<void> | undefined;

  async sendRegisterOtp(phoneNormalized: string, otp: string): Promise<void> {
    this.#started += 1;
    if (this.#barrier !== undefined) {
      await this.#barrier;
    }
    if (this.#failuresLeft > 0) {
      this.#failuresLeft -= 1;
      throw new Error('fake provider failure');
    }
    this.#sent.push({ phoneNormalized, otp });
  }

  failNext(count = 1): void {
    this.#failuresLeft = count;
  }

  /** Makes later sends wait. Call the returned function to let every waiting send continue. */
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

  /** The OTP of the most recent successful send to this number. */
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
  }
}
