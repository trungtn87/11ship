import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { AuditWriter } from '../../audit/audit-writer';
import { AdminIdentityParticipant } from '../../auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../../auth/admin-password-verifier';
import { Argon2idPasswordHasher } from '../../auth/password-hasher';
import { UserRepository } from '../../auth/user-repository';
import { safeErrorCode } from '../../common/safe-error';
import { loadLimiterConfig } from '../../config/admin-auth-config';
import { poolClientSource } from '../../transaction/pg-client-source';
import { TransactionManager } from '../../transaction/transaction-manager';
import { AdminBootstrapService } from '../admin-bootstrap-service';
import { AdminCliError } from '../admin-cli-errors';
import { AdminLimitConfigRepository } from '../admin-limit-config-repository';
import { AdminLimitConfigService } from '../admin-limit-config-service';
import { AdminMembershipRepository } from '../admin-membership-repository';
import {
  CliEnvSource,
  SelfHostedIdentityRow,
  connectedIdentityMatches,
  resolveCliTarget,
  selfHostedIdentityProblem,
} from './cli-target-guard';
import { CliInputError, readBootstrapInput } from './stdin-input';

/**
 * What the SERVER says about the open connection. Read-only. Identical to SELF_HOSTED_IDENTITY_SQL in
 * scripts/db-remote-target.js (the parity test compares the two texts).
 */
export const SELF_HOSTED_IDENTITY_SQL =
  'SELECT current_database() AS database_name, current_user AS user_name, session_user AS session_user_name, ' +
  'inet_server_port() AS server_port, ' +
  'COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls, ' +
  '(SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged';

export type AdminCliCommand = 'init-limit-config' | 'bootstrap-system';

export interface AdminCliIo {
  readonly env: CliEnvSource;
  readonly stdin: Readable;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Operator commands (`npm run admin-auth:init-limit-config`, `npm run admin-auth:bootstrap-system`). They never print
 * a phone number, a password, a key, a URL or a user id: success is one fixed word, refusal one fixed code.
 * Exit code: 0 created or unchanged, 1 refused or failed, 2 usage.
 */
export async function runAdminAuthCli(command: string, io: AdminCliIo): Promise<number> {
  const program = `admin-auth:${command}`;
  const fail = (message: string, code = 1): number => {
    io.err(`${program}: ${message}`);
    return code;
  };
  if (command !== 'init-limit-config' && command !== 'bootstrap-system') {
    return fail('unknown command', 2);
  }

  const resolved = resolveCliTarget(io.env);
  if (!resolved.ok) {
    return fail(resolved.problem);
  }
  const limiter = loadLimiterConfig(io.env);
  if (!limiter.ok) {
    return fail(`invalid or missing configuration. Check environment variable(s): ${limiter.invalid.join(', ')}`);
  }

  // Bootstrap reads its credentials BEFORE any connection, so a malformed input touches nothing.
  let input: { phoneNormalized: string; password: string } | undefined;
  if (command === 'bootstrap-system') {
    try {
      input = await readBootstrapInput(io.stdin);
    } catch (error) {
      return fail(error instanceof CliInputError ? 'INVALID_INPUT: stdin must be one JSON object with exactly "phone" and "password"' : 'INVALID_INPUT');
    }
  }

  const { target } = resolved;
  const pool = new Pool({
    connectionString: target.connectionString,
    ...(target.tls === undefined ? {} : { ssl: { ca: target.tls.ca, rejectUnauthorized: true } }),
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  });
  pool.on('error', () => undefined);

  try {
    if (target.selfHosted) {
      // Self-hosted staging: the server itself must report ship11_staging / ship11_migrator / port 5432 / TLS in use /
      // no elevated role attribute, before anything is read or written.
      const identity = await pool.query<SelfHostedIdentityRow>(SELF_HOSTED_IDENTITY_SQL);
      const problem = selfHostedIdentityProblem(identity.rows[0]);
      if (problem !== undefined) {
        return fail(problem);
      }
    } else {
      const identity = await pool.query<{ database_name: string; user_name: string }>(
        'SELECT current_database() AS database_name, current_user AS user_name',
      );
      const reported = identity.rows[0];
      if (reported === undefined || !connectedIdentityMatches(target, { database: reported.database_name, user: reported.user_name })) {
        return fail('refused: the connected database and role are not the allowed target for this APP_ENV');
      }
    }

    const transactions = new TransactionManager(poolClientSource(pool), { timeoutMs: 30_000, idleInTransactionTimeoutMs: 15_000 });
    const limitConfig = new AdminLimitConfigService(transactions, new AdminLimitConfigRepository());

    if (command === 'init-limit-config') {
      const outcome = await limitConfig.initialize(limiter.limiter);
      io.out(`${program}: ${outcome === 'CREATED' ? 'created' : 'unchanged'}`);
      return 0;
    }

    if (input === undefined) {
      return fail('INVALID_INPUT');
    }
    const bootstrap = new AdminBootstrapService(
      transactions,
      new AdminIdentityParticipant(new UserRepository()),
      new AdminMembershipRepository(),
      limitConfig,
      new AdminPasswordVerifier(new Argon2idPasswordHasher()),
      new AuditWriter(),
    );
    const outcome = await bootstrap.bootstrapSystem(input, limiter.limiter);
    io.out(`${program}: ${outcome === 'CREATED' ? 'created' : 'unchanged'}`);
    return 0;
  } catch (error) {
    if (error instanceof AdminCliError) {
      return fail(`refused: ${error.code}`);
    }
    return fail(`failed (code ${safeErrorCode(error)})`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
