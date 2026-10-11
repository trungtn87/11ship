import { randomBytes } from 'node:crypto';
import { ActivationOtpProvider } from '../admin-activation/activation-otp-provider';
import { OtpProvider } from '../auth/otp-provider';
import { TestInboxConfig, isLoopbackHost } from './test-sms-config';
import { startTestSmsListener, RunningTestSmsListener } from './test-sms-listener';
import { TestSmsInbox } from './test-sms-inbox';
import { Platform, createPlatform } from './test-sms-platform';
import { TestInboxActivationOtpProvider, TestInboxOtpProvider } from './test-sms-providers';
import {
  OwnerClaim,
  ResolvedRepo,
  StateError,
  StateFailure,
  StateHooks,
  claimOwnership,
  publishState,
  releaseOwnership,
  removeOwnState,
  resolveRepo,
} from './test-sms-state';
import { TestSmsStartupCode, TestSmsStartupError } from './test-sms-types';

// The runtime of the test SMS inbox (M01.22): ONE inbox shared by the REGISTER and ADMIN_ACTIVATION adapters, ONE
// private loopback listener, ONE discovery state. It exists only when TEST_INBOX was selected explicitly and the
// configuration loader accepted it (development/test, loopback API host, local database). Nothing is created here
// when the mode is off.
//
// Startup order: guard -> repository identity -> private state directory -> listener -> atomic state publish. A failure
// at any step closes what was already opened and removes only this instance's state, then stops startup with a fixed
// code: the backend never reports it is listening with a listener or state that is incomplete.

export interface TestSmsRuntimeOptions {
  readonly config: TestInboxConfig;
  readonly appEnv: string;
  readonly host: string;
  readonly databaseUrl: string;
  /** Repository root; defaults to the working directory the launcher starts the backend in. */
  readonly repoRoot?: string;
  readonly platform?: Platform;
  readonly inbox?: TestSmsInbox;
  /** Seam for automated isolated tests only (main.ts never passes it). */
  readonly startListener?: typeof startTestSmsListener;
  /** Seam for automated isolated tests only: deterministic barriers inside claim/publish/cleanup. */
  readonly stateHooks?: StateHooks;
}

const FAILURE_CODES: Readonly<Record<StateFailure, TestSmsStartupCode>> = {
  REPO_UNRESOLVED: 'TEST_INBOX_REPO_UNRESOLVED',
  NOT_PRIVATE: 'TEST_INBOX_STATE_NOT_PRIVATE',
  UNSUPPORTED: 'TEST_INBOX_PLATFORM_UNSUPPORTED',
  MISSING: 'TEST_INBOX_STATE_NOT_PRIVATE',
  MALFORMED: 'TEST_INBOX_STATE_NOT_PRIVATE',
  FOREIGN_REPO: 'TEST_INBOX_STATE_NOT_PRIVATE',
  FOREIGN_USER: 'TEST_INBOX_STATE_NOT_PRIVATE',
  STALE: 'TEST_INBOX_STATE_NOT_PRIVATE',
  IN_USE: 'TEST_INBOX_STATE_IN_USE',
  WRITE_FAILED: 'TEST_INBOX_STATE_WRITE_FAILED',
  LOST_OWNERSHIP: 'TEST_INBOX_STATE_IN_USE',
};

function startupError(error: unknown): TestSmsStartupError {
  if (error instanceof TestSmsStartupError) {
    return error;
  }
  if (error instanceof StateError) {
    return new TestSmsStartupError(FAILURE_CODES[error.failure]);
  }
  return new TestSmsStartupError('TEST_INBOX_STATE_WRITE_FAILED');
}

function databaseIsLocal(databaseUrl: string): boolean {
  try {
    return isLoopbackHost(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

export class TestSmsRuntime {
  readonly inbox: TestSmsInbox;
  /** Bound as the REGISTER provider only when OTP_PROVIDER=TEST_INBOX. */
  readonly registerProvider: OtpProvider | undefined;
  /** Bound as the activation provider only when ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX. */
  readonly activationProvider: ActivationOtpProvider | undefined;
  readonly #platform: Platform;
  readonly #repoRoot: string;
  readonly #startListener: typeof startTestSmsListener;
  #repo: ResolvedRepo | undefined;
  #listener: RunningTestSmsListener | undefined;
  readonly #hooks: StateHooks;
  #claim: OwnerClaim | undefined;
  #published = false;
  #started = false;

  constructor(options: TestSmsRuntimeOptions) {
    // Defense in depth: the configuration loader already refused every other target, before anything opened.
    if (
      (options.appEnv !== 'development' && options.appEnv !== 'test') ||
      !isLoopbackHost(options.host) ||
      !databaseIsLocal(options.databaseUrl)
    ) {
      throw new TestSmsStartupError('TEST_INBOX_NOT_LOCAL');
    }
    this.inbox = options.inbox ?? new TestSmsInbox();
    this.registerProvider = options.config.register ? new TestInboxOtpProvider(this.inbox) : undefined;
    this.activationProvider = options.config.activation ? new TestInboxActivationOtpProvider(this.inbox) : undefined;
    this.#platform = options.platform ?? createPlatform();
    this.#repoRoot = options.repoRoot ?? process.cwd();
    this.#startListener = options.startListener ?? startTestSmsListener;
    this.#hooks = options.stateHooks ?? {};
  }

  /** Port of the private listener once started (never published anywhere except the private state file). */
  get listenerPort(): number | undefined {
    return this.#listener?.port;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    try {
      this.#repo = await resolveRepo(this.#platform, this.#repoRoot);
      this.#claim = await claimOwnership(this.#platform, this.#repo, this.#hooks);
      const token = randomBytes(32).toString('base64url');
      try {
        this.#listener = await this.#startListener({ inbox: this.inbox, token });
      } catch {
        throw new TestSmsStartupError('TEST_INBOX_LISTENER_FAILED');
      }
      await publishState(this.#platform, this.#repo, this.#claim, { port: this.#listener.port, token }, this.#hooks);
      this.#published = true;
      this.#started = true;
    } catch (error) {
      await this.stop();
      throw startupError(error);
    }
  }

  /**
   * Idempotent. Order matters: remove this instance's state, close the listener, empty the inbox, and only then give the
   * ownership up. A runtime that never obtained the claim (it lost the race) touches NOTHING on disk.
   */
  async stop(): Promise<void> {
    const claim = this.#claim;
    const published = this.#published;
    const repo = this.#repo;
    const listener = this.#listener;
    this.#claim = undefined;
    this.#published = false;
    this.#listener = undefined;
    this.#started = false;
    if (claim !== undefined && repo !== undefined && published) {
      await removeOwnState(this.#platform, repo, claim, this.#hooks);
    }
    if (listener !== undefined) {
      await listener.stop().catch(() => undefined);
    }
    this.inbox.clear();
    if (claim !== undefined && repo !== undefined) {
      await releaseOwnership(this.#platform, repo, claim, this.#hooks);
    }
  }
}

export function createTestSmsRuntime(options: TestSmsRuntimeOptions): TestSmsRuntime {
  return new TestSmsRuntime(options);
}
