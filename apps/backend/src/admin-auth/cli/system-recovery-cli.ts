import { Pool } from 'pg';
import { AuditWriter } from '../../audit/audit-writer';
import { AdminSessionRevocationParticipant } from '../../auth/admin-session-revocation-participant';
import { AdminPasswordVerifier } from '../../auth/admin-password-verifier';
import { Argon2idPasswordHasher } from '../../auth/password-hasher';
import { UserRepository } from '../../auth/user-repository';
import { poolClientSource } from '../../transaction/pg-client-source';
import { TransactionManager } from '../../transaction/transaction-manager';
import { AdminChallengeRepository } from '../admin-challenge-repository';
import { AdminCliError } from '../admin-cli-errors';
import { AdminMembershipRepository } from '../admin-membership-repository';
import { AdminSessionRepository } from '../admin-session-repository';
import { SystemRecoveryService } from '../system-recovery-service';
import type { AdminCliIo } from './admin-auth-cli';
import { connectedIdentityMatches, resolveLocalRecoveryTarget } from './cli-target-guard';
import { readSystemRecoveryApplyInput, readSystemRecoveryCheckInput } from './stdin-input';

const PROGRAM = 'admin-auth:recover-system';

/**
 * `npm run admin-auth:recover-system -- --check|--apply` (M01-RESET, local/CI only). Output is fixed codes and the version:
 * never a phone, password, hash, user id, URL or raw error. Exit 0 done, 1 refused/failed, 2 usage.
 */
export async function runSystemRecoveryCli(io: AdminCliIo): Promise<number> {
  const fail = (message: string, code = 1): number => {
    io.err(`${PROGRAM}: ${message}`);
    return code;
  };
  const args = io.argv ?? [];
  const mode = args.length === 1 ? args[0] : undefined;
  if (mode !== '--check' && mode !== '--apply') {
    return fail('usage: exactly one of --check or --apply', 2);
  }

  // Environment first: nothing is read from stdin and nothing is connected for a refused target.
  const resolved = resolveLocalRecoveryTarget(io.env);
  if (!resolved.ok) {
    return fail(resolved.problem);
  }
  let check: { phoneNormalized: string } | undefined;
  let apply: { phoneNormalized: string; password: string; expectedVersion: number } | undefined;
  try {
    if (mode === '--check') {
      check = await readSystemRecoveryCheckInput(io.stdin);
    } else {
      apply = await readSystemRecoveryApplyInput(io.stdin);
    }
  } catch {
    return fail(
      mode === '--check'
        ? 'INVALID_INPUT: stdin must be one JSON object with exactly "phone"'
        : 'INVALID_INPUT: stdin must be one JSON object with exactly "phone", "password", "expected_version", "confirmation"',
    );
  }

  const { target } = resolved;
  const pool = new Pool({
    connectionString: target.connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  });
  pool.on('error', () => undefined);
  try {
    const identity = await pool.query<{ database_name: string; user_name: string; session_name: string }>(
      'SELECT current_database() AS database_name, current_user AS user_name, session_user AS session_name',
    );
    const reported = identity.rows[0];
    if (
      reported === undefined ||
      !connectedIdentityMatches(target, { database: reported.database_name, user: reported.user_name }) ||
      reported.session_name !== target.expected?.user
    ) {
      return fail('refused: the connected database and role are not the allowed local target');
    }
    const transactions = new TransactionManager(poolClientSource(pool), { timeoutMs: 30_000, idleInTransactionTimeoutMs: 15_000 });
    const service = new SystemRecoveryService(
      transactions,
      new UserRepository(),
      new AdminMembershipRepository(),
      new AdminSessionRevocationParticipant(),
      new AdminSessionRepository(),
      new AdminChallengeRepository(),
      new AdminPasswordVerifier(new Argon2idPasswordHasher()),
      new AuditWriter(),
    );
    if (check !== undefined) {
      const { version } = await service.check(check.phoneNormalized);
      io.out(`${PROGRAM}: SYSTEM_FOUND version=${version}`);
      return 0;
    }
    if (apply === undefined) {
      return fail('INVALID_INPUT');
    }
    const { version } = await service.apply(apply);
    io.out(`${PROGRAM}: RECOVERED version=${version}`);
    return 0;
  } catch (error) {
    if (error instanceof AdminCliError) {
      return fail(`refused: ${error.code}`);
    }
    if (mode === '--apply' && (error as { code?: unknown } | null)?.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
      return fail('OUTCOME_UNKNOWN: do not resend; run --check to read the version, then try to log in');
    }
    return fail('failed');
  } finally {
    await pool.end().catch(() => undefined);
  }
}
