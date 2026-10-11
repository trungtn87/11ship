// M01.22 configuration of the test SMS inbox. Pure validation: nothing here reads the environment by itself. Only the
// NAMES of invalid variables are ever reported, never their values.
//
// TEST_INBOX is selected EXPLICITLY, per channel:
//   OTP_PROVIDER=TEST_INBOX               REGISTER (Auth Core). A NEW variable: before M01.22 "OTP_PROVIDER" was only the
//                                         name printed when staging/production had no provider. Unset keeps the previous
//                                         behaviour (in-memory fake in development/test, refusal elsewhere).
//   ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX  ADMIN_ACTIVATION (needs ADMIN_ACTIVATION_ENABLED=true). Other modes unchanged.
// Selecting it outside development/test, or without a loopback target, stops startup. There is no fallback.

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface TestInboxConfig {
  /** OTP_PROVIDER=TEST_INBOX: Auth Core REGISTER delivers into the inbox. */
  readonly register: boolean;
  /** ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX with the activation enabled: the activation delivers into the inbox. */
  readonly activation: boolean;
}

export type TestInboxConfigResult =
  | { readonly ok: true; readonly config: TestInboxConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function databaseHostIsLoopback(databaseUrl: string | undefined): boolean {
  if (databaseUrl === undefined) {
    return false;
  }
  try {
    return isLoopbackHost(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

export interface TestInboxConfigInput {
  readonly env: EnvSource;
  readonly appEnv: string | undefined;
  readonly host: string;
  readonly databaseUrl: string | undefined;
  /** True only when ADMIN_ACTIVATION_ENABLED=true resolved to a valid activation configuration. */
  readonly activationEnabled: boolean;
}

/**
 * Returns the config only when TEST_INBOX is really in use (a REGISTER or an activation selection that has an adapter to
 * feed it). The listener exists only then: APP_ENV alone never opens it.
 */
export function loadTestInboxConfig(input: TestInboxConfigInput): TestInboxConfigResult {
  const invalid: string[] = [];
  const rawProvider = input.env.OTP_PROVIDER;
  let register = false;
  if (rawProvider !== undefined) {
    if (rawProvider === 'TEST_INBOX') {
      register = true;
    } else {
      invalid.push('OTP_PROVIDER');
    }
  }
  const activationSelected = input.env.ADMIN_ACTIVATION_OTP_MODE === 'TEST_INBOX';
  const selected = register || activationSelected;
  if (!selected) {
    return invalid.length > 0 ? { ok: false, invalid } : { ok: true, config: undefined };
  }

  const localEnvironment = input.appEnv === 'development' || input.appEnv === 'test';
  if (!localEnvironment) {
    // Staging, production (and an invalid APP_ENV, already reported by its own name): refuse every selection.
    if (input.appEnv !== undefined) {
      if (register) {
        invalid.push('OTP_PROVIDER');
      }
      if (activationSelected) {
        invalid.push('ADMIN_ACTIVATION_OTP_MODE');
      }
    }
    return { ok: false, invalid };
  }

  const activationActive = activationSelected && input.activationEnabled;
  const active = register || activationActive;
  if (!active) {
    // Selected for the activation but the activation is disabled: nothing would feed the inbox, so nothing opens.
    return invalid.length > 0 ? { ok: false, invalid } : { ok: true, config: undefined };
  }

  // The "local target" guard: the API binds to loopback and the database is on this machine.
  if (!isLoopbackHost(input.host)) {
    invalid.push('HOST');
  }
  if (!databaseHostIsLoopback(input.databaseUrl)) {
    invalid.push('DATABASE_URL');
  }
  if (invalid.length > 0) {
    // Name the selection too, so the operator sees that TEST_INBOX is what the target guard refused.
    if (register) {
      invalid.push('OTP_PROVIDER');
    }
    if (activationActive) {
      invalid.push('ADMIN_ACTIVATION_OTP_MODE');
    }
    return { ok: false, invalid };
  }
  return { ok: true, config: { register, activation: activationActive } };
}
