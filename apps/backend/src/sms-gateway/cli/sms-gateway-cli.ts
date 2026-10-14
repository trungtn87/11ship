import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { CliEnvSource, connectedIdentityMatches, resolveCliTarget } from '../../admin-auth/cli/cli-target-guard';
import { generateToken } from '../../auth/tokens';
import { safeErrorCode } from '../../common/safe-error';
import { poolClientSource } from '../../transaction/pg-client-source';
import { TransactionManager } from '../../transaction/transaction-manager';
import { SMS_DEVICE_LABEL_PATTERN } from '../sms-gateway-constants';
import { SmsGatewayRepository } from '../sms-gateway-repository';

export interface SmsGatewayCliIo {
  readonly env: CliEnvSource;
  readonly argv: readonly string[];
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE =
  'usage: sms-gateway:ctl pair --label <name> | list | revoke --device-id <uuid> | enable | disable';

/**
 * Operator tool for the SMS gateway (issue #102): pairing, listing, revoking and the backend kill switch. It is the ONLY way to
 * create a gateway credential; there is no HTTP route for it. The credential (256 random bits) is printed exactly once on
 * standard output and only its SHA-256 is stored, so a lost credential is replaced by pairing again and revoking the old device.
 * Exit code: 0 done, 1 refused or failed, 2 usage.
 */
export async function runSmsGatewayCli(io: SmsGatewayCliIo): Promise<number> {
  const program = 'sms-gateway:ctl';
  const fail = (message: string, code = 1): number => {
    io.err(`${program}: ${message}`);
    return code;
  };
  const [command, ...rest] = io.argv;
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  if (command === undefined || !['pair', 'list', 'revoke', 'enable', 'disable'].includes(command)) {
    return fail(USAGE, 2);
  }
  const label = flag('--label');
  const deviceId = flag('--device-id');
  if (command === 'pair' && (label === undefined || !SMS_DEVICE_LABEL_PATTERN.test(label))) {
    return fail('--label must be 1..64 characters of letters, digits, space . _ -', 2);
  }
  if (command === 'revoke' && (deviceId === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(deviceId))) {
    return fail('--device-id must be a device UUID', 2);
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
    const identity = await pool.query<{ database_name: string; user_name: string }>(
      'SELECT current_database() AS database_name, current_user AS user_name',
    );
    const reported = identity.rows[0];
    if (reported === undefined || !connectedIdentityMatches(target, { database: reported.database_name, user: reported.user_name })) {
      return fail('refused: the connected database and role are not the allowed target for this APP_ENV');
    }
    const transactions = new TransactionManager(poolClientSource(pool), { timeoutMs: 30_000, idleInTransactionTimeoutMs: 15_000 });
    const repository = new SmsGatewayRepository();

    switch (command) {
      case 'pair': {
        const { token, digest } = generateToken();
        const id = randomUUID();
        await transactions.withTransaction((context) =>
          repository.insertDevice(context, { deviceId: id, label: label as string, credentialDigest: digest }),
        );
        io.out(`${program}: paired device ${id}`);
        io.out(`${program}: credential (shown ONCE, enter it in the gateway app, never store it elsewhere): ${token}`);
        return 0;
      }
      case 'list': {
        const devices = await transactions.withTransaction((context) => repository.listDevices(context));
        for (const device of devices) {
          io.out(
            [
              device.deviceId,
              device.status,
              JSON.stringify(device.label),
              `seen=${device.lastSeenAtMs === undefined ? 'never' : new Date(device.lastSeenAtMs).toISOString()}`,
              `app=${device.appVersion ?? '-'}`,
              `sms_permission=${device.smsPermission ?? '-'}`,
              `paused=${device.paused ?? '-'}`,
            ].join(' '),
          );
        }
        const enabled = await transactions.withTransaction((context) => repository.sendingEnabled(context));
        io.out(`${program}: sending ${enabled ? 'ENABLED' : 'DISABLED'}`);
        return 0;
      }
      case 'revoke': {
        const revoked = await transactions.withTransaction((context) => repository.revokeDevice(context, deviceId as string));
        io.out(`${program}: ${revoked ? 'revoked' : 'no active device with that id'}`);
        return revoked ? 0 : 1;
      }
      case 'enable':
      case 'disable': {
        await transactions.withTransaction((context) => repository.setSendingEnabled(context, command === 'enable'));
        io.out(`${program}: sending ${command === 'enable' ? 'ENABLED' : 'DISABLED'}`);
        return 0;
      }
    }
    return fail(USAGE, 2);
  } catch (error) {
    return fail(`failed (code ${safeErrorCode(error)})`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
