import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { ActivationOtpDelivery, ActivationOtpProvider } from '../../../apps/backend/src/admin-activation/activation-otp-provider';
import { OtpProvider } from '../../../apps/backend/src/auth/otp-provider';
import { AppConfig } from '../../../apps/backend/src/config/app-config';
import { AuthConfig } from '../../../apps/backend/src/config/auth-config';
import { fixtureKeyring } from '../../../apps/backend/src/crypto/test-keys.fixture';
import { TestSmsInbox } from '../../../apps/backend/src/test-sms/test-sms-inbox';
import { RunningTestSmsListener, startTestSmsListener } from '../../../apps/backend/src/test-sms/test-sms-listener';
import { TestInboxActivationOtpProvider, TestInboxOtpProvider } from '../../../apps/backend/src/test-sms/test-sms-providers';
import { TestSmsPurpose } from '../../../apps/backend/src/test-sms/test-sms-types';
import { ToolClient, createToolClient } from '../../../apps/backend/src/test-sms/tool-client';
import { api, ApiOptions, ApiResponse, authTestConfig, purgePhone, purgeTestServiceAreas } from './auth-fixtures';
import { loadIntegrationConfig, RunningApp, startApp } from './test-helpers';
import { testPool } from './transaction-fixtures';

// Fixtures of the M01.22 suites: the REAL Nest pipeline and the REAL PostgreSQL, with the OTP delivered into the
// REAL test inbox and read back through the REAL private listener and the operator tool's own HTTP client, exactly the
// way the PC tool reads it. Test database only (TEST5433, guarded by the integration global setup).

export interface InboxHarness {
  readonly inbox: TestSmsInbox;
  readonly listener: RunningTestSmsListener;
  readonly token: string;
  readonly client: ToolClient;
  stop(): Promise<void>;
}

/** The listener clock advances one second per call, so the read quota never blocks a long scenario (it has its own suite). */
export async function startInboxHarness(): Promise<InboxHarness> {
  const inbox = new TestSmsInbox();
  const token = randomBytes(32).toString('base64url');
  let tick = 1_000_000;
  const listener = await startTestSmsListener({ inbox, token, now: () => (tick += 1000) });
  return {
    inbox,
    listener,
    token,
    client: createToolClient({ host: listener.host, port: listener.port, token }),
    stop: () => listener.stop(),
  };
}

/** Reads the newest code of a number and purpose the way the PC tool does: list (masked), then one detail. */
export async function readOtp(harness: InboxHarness, purpose: TestSmsPurpose, phoneNormalized: string): Promise<string> {
  const [newest] = await harness.client.list({ purpose, phone: phoneNormalized, limit: 1 });
  if (newest === undefined) {
    throw new Error('the test inbox has no message for this number and purpose');
  }
  return (await harness.client.get(newest.messageId)).otp;
}

export type InboxFault = 'REJECT' | 'THROW' | 'LOST_RESPONSE' | 'HANG';

/** REGISTER adapter with scripted faults around the real inbox adapter. */
export class ScriptedRegisterInbox implements OtpProvider {
  readonly #real: TestInboxOtpProvider;
  readonly #script: InboxFault[] = [];
  #release: (() => void) | undefined;
  #started = 0;

  constructor(inbox: TestSmsInbox) {
    this.#real = new TestInboxOtpProvider(inbox);
  }

  script(...faults: InboxFault[]): void {
    this.#script.push(...faults);
  }

  get started(): number {
    return this.#started;
  }

  releaseHang(): void {
    this.#release?.();
  }

  async sendRegisterOtp(phoneNormalized: string, otp: string): Promise<void> {
    this.#started += 1;
    const fault = this.#script.shift();
    if (fault === 'REJECT' || fault === 'THROW') {
      throw new Error('scripted inbox failure');
    }
    if (fault === 'LOST_RESPONSE') {
      await this.#real.sendRegisterOtp(phoneNormalized, otp);
      throw new Error('scripted lost response');
    }
    if (fault === 'HANG') {
      await new Promise<void>((resolve) => {
        this.#release = resolve;
      });
      throw new Error('scripted hang released');
    }
    await this.#real.sendRegisterOtp(phoneNormalized, otp);
  }
}

/** ADMIN_ACTIVATION adapter with scripted faults around the real inbox adapter. */
export class ScriptedActivationInbox implements ActivationOtpProvider {
  readonly mode = 'TEST_INBOX' as const;
  readonly #real: TestInboxActivationOtpProvider;
  readonly #script: InboxFault[] = [];
  #release: (() => void) | undefined;
  #started = 0;

  constructor(inbox: TestSmsInbox) {
    this.#real = new TestInboxActivationOtpProvider(inbox);
  }

  script(...faults: InboxFault[]): void {
    this.#script.push(...faults);
  }

  get started(): number {
    return this.#started;
  }

  releaseHang(): void {
    this.#release?.();
  }

  async send(phoneNormalized: string, otp: string): Promise<ActivationOtpDelivery> {
    this.#started += 1;
    const fault = this.#script.shift();
    if (fault === 'REJECT') {
      return { outcome: 'REJECTED' };
    }
    if (fault === 'THROW') {
      throw new Error('scripted inbox failure');
    }
    if (fault === 'LOST_RESPONSE') {
      await this.#real.send(phoneNormalized, otp);
      throw new Error('scripted lost response');
    }
    if (fault === 'HANG') {
      await new Promise<void>((resolve) => {
        this.#release = resolve;
      });
      return { outcome: 'UNKNOWN' };
    }
    return this.#real.send(phoneNormalized, otp);
  }
}

export interface InboxAuthApp {
  readonly running: RunningApp;
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly harness: InboxHarness;
  readonly provider: ScriptedRegisterInbox;
  call(method: 'GET' | 'POST' | 'PUT', path: string, options?: ApiOptions): Promise<ApiResponse>;
  track(normalizedPhone: string): void;
  close(): Promise<void>;
}

/** Same wiring as startAuthApp, except the OTP provider is the TEST_INBOX adapter (REGISTER). */
export async function startInboxAuthApp(
  authOverrides: Partial<AuthConfig> = {},
  configOverride: Partial<AppConfig> = {},
): Promise<InboxAuthApp> {
  const loaded = loadIntegrationConfig();
  const config: AppConfig = { ...loaded, crypto: fixtureKeyring('k1'), auth: authTestConfig(authOverrides), ...configOverride };
  const harness = await startInboxHarness();
  const provider = new ScriptedRegisterInbox(harness.inbox);
  const running = await startApp(config, { auth: { otpProvider: provider } });
  const pool = testPool(loaded.database, { poolMax: 6 });
  const tracked = new Set<string>();
  return {
    running,
    config,
    pool,
    harness,
    provider,
    call: (method, path, options) => api(running.baseUrl, method, path, options),
    track: (phone) => {
      tracked.add(phone);
    },
    async close(): Promise<void> {
      try {
        for (const phone of tracked) {
          await purgePhone(pool, phone);
        }
        await purgeTestServiceAreas(pool);
      } finally {
        await pool.end();
        await running.app.close();
        await harness.stop();
      }
    },
  };
}

/** True when `text` contains the code as a standalone 6-digit number (not part of a longer digit run). */
export function containsCode(text: string, code: string): boolean {
  return new RegExp(`(?<![0-9])${code}(?![0-9])`).test(text);
}
