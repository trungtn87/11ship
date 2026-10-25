import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { ActivationOtpProvider } from '../../../apps/backend/src/admin-activation/activation-otp-provider';
import { ActivationSmsGatewayBinding } from '../../../apps/backend/src/admin-activation/activation-otp-providers';
import { AppModule } from '../../../apps/backend/src/app.module';
import { AuthModuleOptions } from '../../../apps/backend/src/auth/auth.module';
import { configureApp } from '../../../apps/backend/src/app.setup';
import {
  AppConfig,
  formatInvalidConfigMessage,
  loadConfig,
} from '../../../apps/backend/src/config/app-config';
import { JsonLogger } from '../../../apps/backend/src/logging/json-logger';

// Compiled location is <root>/.test-dist/tests/integration/support, so the repo root is 4 levels up.
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const COMPILED_MAIN = path.join(REPO_ROOT, '.test-dist', 'apps', 'backend', 'src', 'main.js');
export const GUARD_CLI = path.join(__dirname, 'guard-cli.js');

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function loadIntegrationConfig(): AppConfig {
  const result = loadConfig(process.env);
  if (!result.ok) {
    throw new Error(formatInvalidConfigMessage(result.invalid));
  }
  return result.config;
}

export function configWithDatabaseUrl(base: AppConfig, url: string): AppConfig {
  return { ...base, database: { ...base.database, url } };
}

/** Same server, user and password; only the database name differs. */
export function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export interface RunningApp {
  app: INestApplication;
  baseUrl: string;
  logs: string[];
}

export interface StartAppOptions {
  /** Binds Auth Core (with an explicit OTP provider), exactly as main.ts does. Omitted: no Auth routes. */
  readonly auth?: AuthModuleOptions;
  /** M01-D-ADMIN-1C: the explicitly bound activation OTP provider (only used when config.adminActivation is set). */
  readonly activationOtpProvider?: ActivationOtpProvider | ActivationSmsGatewayBinding;
  /** Runs after configureApp and BEFORE the application initializes (listen), exactly where main.ts installs the Admin hosting. */
  readonly beforeListen?: (app: INestApplication) => void;
  /** Replaces providers of the compiled module with fixed values (for example the M04 wallet port, which does not exist yet). */
  readonly overrides?: ReadonlyArray<{ readonly provide: unknown; readonly useValue: unknown }>;
}

/**
 * Issue #117: the OTP limits live in PostgreSQL (app.otp_policy) and every request counts against the client address, so the many OTP
 * requests that ordinary suites make from 127.0.0.1 would trip the production defaults (3/h per phone, 10/h per address). Each app
 * start therefore resets the policy to a roomy baseline (cooldown and wrong-attempt limit stay at their defaults) and empties the
 * address counter; the suites that test the limits set their own values through setOtpPolicy. Test database only.
 */
export const TEST_OTP_POLICY = { cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 20, phone_per_day: 100, ip_per_hour: 1000, global_per_day: 10_000 } as const;

export async function setOtpPolicy(url: string, values: Partial<Record<keyof typeof TEST_OTP_POLICY, number>> = {}): Promise<void> {
  const next = { ...TEST_OTP_POLICY, ...values };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query("SELECT to_regclass('app.otp_policy') AS t");
    if ((exists.rows[0] as { t: string | null }).t === null) {
      return;
    }
    await client.query('DELETE FROM app.otp_ip_requests');
    await client.query(
      `UPDATE app.otp_policy SET cooldown_seconds = $1, max_wrong_attempts = $2, phone_per_hour = $3, phone_per_day = $4,
              ip_per_hour = $5, global_per_day = $6, version = 1, updated_by = NULL WHERE policy_id = 1`,
      [next.cooldown_seconds, next.max_wrong_attempts, next.phone_per_hour, next.phone_per_day, next.ip_per_hour, next.global_per_day],
    );
  } finally {
    await client.end();
  }
}

/** Boots the real AppModule through the same HTTP pipeline as main.ts, on a random free port. */
export async function startApp(config: AppConfig, options: StartAppOptions = {}): Promise<RunningApp> {
  const logs: string[] = [];
  const logger = new JsonLogger((line) => {
    logs.push(line);
  });
  if (options.auth !== undefined) {
    await setOtpPolicy(config.database.url);
  }

  let builder = Test.createTestingModule({
    imports: [
      AppModule.register({
        config,
        logger,
        ...(options.auth === undefined ? {} : { auth: options.auth }),
        ...(options.activationOtpProvider === undefined ? {} : { activationOtpProvider: options.activationOtpProvider }),
      }),
    ],
  });
  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.provide as never).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  options.beforeListen?.(app);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, logs };
}

/** Child processes get a minimal environment so nothing from the parent leaks into F05/F06 cases. */
export function minimalChildEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

export function runNpmScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath === undefined) {
    throw new Error('npm_execpath is not set. Run the tests through "npm run test:integration".');
  }
  return spawnSync(process.execPath, [npmExecPath, 'run', script, '--', ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
}
