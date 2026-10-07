import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
}

/** Boots the real AppModule through the same HTTP pipeline as main.ts, on a random free port. */
export async function startApp(config: AppConfig, options: StartAppOptions = {}): Promise<RunningApp> {
  const logs: string[] = [];
  const logger = new JsonLogger((line) => {
    logs.push(line);
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ config, logger, ...(options.auth === undefined ? {} : { auth: options.auth }) })],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
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
