import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { CliEnvSource, connectedIdentityMatches, resolveCliTarget } from '../../admin-auth/cli/cli-target-guard';
import { safeErrorCode } from '../../common/safe-error';
import { poolClientSource } from '../../transaction/pg-client-source';
import { TransactionManager } from '../../transaction/transaction-manager';
import { INGEST_KEY_SCOPES, IngestKeyScope } from '../ops-constants';
import { OpsReleaseRepository } from '../ops-release-repository';

export interface OpsCliIo {
  readonly env: CliEnvSource;
  readonly argv: readonly string[];
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = 'usage: ops:ctl ingest-key create --label <name> --scope PROBE|BACKUP|DEPLOY | ingest-key list | ingest-key revoke --key-id <uuid>';
const LABEL = /^[A-Za-z0-9 ._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Operator tool of M13: the machine credentials of the independent probe, the backup job and the deploy pipeline. It is the ONLY way to create one (there is no
 * HTTP route for it). The credential (256 random bits) is printed exactly once and only its SHA-256 is stored, so a lost one is replaced by creating another and
 * revoking the old. One scope per credential: a probe key cannot report a backup or a deploy. Exit code: 0 done, 1 refused or failed, 2 usage.
 */
export async function runOpsCli(io: OpsCliIo): Promise<number> {
  const program = 'ops:ctl';
  const fail = (message: string, code = 1): number => {
    io.err(`${program}: ${message}`);
    return code;
  };
  const [group, command, ...rest] = io.argv;
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  if (group !== 'ingest-key' || command === undefined || !['create', 'list', 'revoke'].includes(command)) {
    return fail(USAGE, 2);
  }
  const label = flag('--label');
  const scope = flag('--scope');
  const keyId = flag('--key-id');
  if (command === 'create' && (label === undefined || !LABEL.test(label) || scope === undefined || !(INGEST_KEY_SCOPES as readonly string[]).includes(scope))) {
    return fail('create needs --label (1..64 letters, digits, space . _ -) and --scope PROBE|BACKUP|DEPLOY', 2);
  }
  if (command === 'revoke' && (keyId === undefined || !UUID.test(keyId))) {
    return fail('--key-id must be a key UUID', 2);
  }
  const resolved = resolveCliTarget(io.env);
  if (!resolved.ok) {
    return fail(resolved.problem);
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
    const identity = await pool.query<{ database_name: string; user_name: string }>('SELECT current_database() AS database_name, current_user AS user_name');
    const reported = identity.rows[0];
    if (reported === undefined || !connectedIdentityMatches(target, { database: reported.database_name, user: reported.user_name })) {
      return fail('refused: the connected database and role are not the allowed target for this APP_ENV');
    }
    const transactions = new TransactionManager(poolClientSource(pool), { timeoutMs: 30_000, idleInTransactionTimeoutMs: 15_000 });
    const repository = new OpsReleaseRepository();
    switch (command) {
      case 'create': {
        const secret = randomBytes(32).toString('base64url');
        const id = randomUUID();
        await transactions.withTransaction((context) => repository.insertIngestKey(context, { keyId: id, label: label as string, scope: scope as IngestKeyScope, digest: createHash('sha256').update(secret, 'utf8').digest('hex') }));
        io.out(`${program}: created key ${id} (${scope})`);
        io.out(`${program}: credential (shown ONCE, put it in the reporter's secret file, never store it elsewhere): ${secret}`);
        return 0;
      }
      case 'list': {
        for (const key of await transactions.withTransaction((context) => repository.listIngestKeys(context))) {
          io.out([key.keyId, key.status, key.scope, JSON.stringify(key.label), `used=${key.lastUsedAtMs === null ? 'never' : new Date(key.lastUsedAtMs).toISOString()}`].join(' '));
        }
        return 0;
      }
      case 'revoke': {
        const revoked = await transactions.withTransaction((context) => repository.revokeIngestKey(context, keyId as string));
        io.out(`${program}: ${revoked ? 'revoked' : 'no active key with that id'}`);
        return revoked ? 0 : 1;
      }
    }
    return fail(USAGE, 2);
  } catch (error) {
    return fail(`failed (code ${safeErrorCode(error)})`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
