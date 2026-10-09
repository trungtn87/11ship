import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import {
  AdminInvitationParticipant,
  CreateInvitationInput,
} from '../../apps/backend/src/admin-invitations/admin-invitation-participant';
import { AdminInvitationRepository, InvitationPermission } from '../../apps/backend/src/admin-invitations/admin-invitation-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { deferred, failureOf } from './support/async-helpers';
import { purgePhone, randomPhone } from './support/auth-fixtures';
import { waitForBlockedBackends } from './support/lock-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';

// M01-D-ADMIN-1A against a REAL PostgreSQL test database: the invitation tables, their triggers and the participant.
// Nothing here is mocked. The tables refuse DELETE by trigger, so the suite empties them with TRUNCATE (test database
// only: global-setup has already verified the target) and removes its own users afterwards.
describe('M01-D-ADMIN-1A - admin invitations (schema, participant, transactions)', () => {
  const repository = new AdminInvitationRepository();
  const participant = new AdminInvitationParticipant(repository);
  const phonesToPurge: string[] = [];
  const VIEW: InvitationPermission = { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false };
  let pool: Pool;
  let creatorId: string;
  let otherCreatorId: string;
  let acceptedUserId: string;

  const manager = () => managerFor(poolClientSource(pool));

  async function truncateInvitations(): Promise<void> {
    await pool.query('TRUNCATE app.admin_invitation_permissions, app.admin_invitations');
  }

  async function makeUser(admin: boolean): Promise<string> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', ${admin ? 'NULL' : 'now()'}, $3, 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, admin ? 'ADMIN_PROVISIONED' : 'PHONE_VERIFIED'],
    );
    if (admin) {
      // Never SYSTEM: another suite owns the single SYSTEM account and purges it.
      await pool.query(
        `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
         VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
        [userId],
      );
    }
    return userId;
  }

  const newPhone = (): string => `+849${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const newDigest = (): string => randomBytes(32).toString('hex');

  function input(overrides: Partial<CreateInvitationInput> = {}): CreateInvitationInput {
    return {
      invitationId: randomUUID(),
      generationId: randomUUID(),
      phoneNormalized: newPhone(),
      fullName: 'Nguyen Van A',
      note: null,
      tokenDigest: newDigest(),
      createdBy: creatorId,
      ttlSeconds: 72 * 3600,
      permissions: [VIEW],
      ...overrides,
    };
  }

  /** A raw row. The three timestamp fields are SQL expressions (text inlined into the statement); the rest are parameters. */
  interface RawInvitation {
    invitation_id: string;
    generation_id: string;
    phone_normalized: string;
    full_name: string;
    note: string | null;
    token_digest: string;
    status: string;
    version: number;
    created_by: string;
    created_at: string;
    expires_at: string;
    terminal_at: string;
    accepted_user_id: string | null;
    successor_id: string | null;
    snapshot_sealed: boolean;
  }

  function rawRow(overrides: Partial<RawInvitation> = {}): RawInvitation {
    return {
      invitation_id: randomUUID(),
      generation_id: randomUUID(),
      phone_normalized: newPhone(),
      full_name: 'Raw Row',
      note: null,
      token_digest: newDigest(),
      status: 'PENDING',
      version: 1,
      created_by: creatorId,
      created_at: 'now()',
      expires_at: "now() + interval '1 hour'",
      terminal_at: 'NULL',
      accepted_user_id: null,
      successor_id: null,
      snapshot_sealed: false,
      ...overrides,
    };
  }

  const SQL_EXPRESSION_COLUMNS: readonly string[] = ['created_at', 'expires_at', 'terminal_at'];
  const UUID_COLUMNS: readonly string[] = ['invitation_id', 'generation_id', 'created_by', 'accepted_user_id', 'successor_id'];

  async function insertRaw(client: PoolClient, row: RawInvitation): Promise<string> {
    const columns = Object.keys(row);
    const values: unknown[] = [];
    const placeholders = columns.map((column) => {
      const value = (row as unknown as Record<string, unknown>)[column];
      if (SQL_EXPRESSION_COLUMNS.includes(column)) {
        return value as string;
      }
      values.push(value);
      return `$${String(values.length)}${UUID_COLUMNS.includes(column) ? '::uuid' : ''}`;
    });
    await client.query(`INSERT INTO app.admin_invitations (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
    return row.invitation_id;
  }

  async function insertRawPermission(client: PoolClient, invitationId: string, permission: InvitationPermission = VIEW): Promise<void> {
    await client.query(
      `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [invitationId, permission.app, permission.canView, permission.canReviewProfile, permission.canLock],
    );
  }

  /** Runs work in a transaction that is always rolled back; returns the PostgreSQL SQLSTATE of the failure, or 'OK'. */
  async function stateOf(work: (client: PoolClient) => Promise<unknown>): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      return 'OK';
    } catch (error) {
      return sqlStateOf(error);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** Runs work and COMMITs on a dedicated connection; returns 'OK' or the SQLSTATE of the failing statement or commit. */
  async function commitState(work: (client: PoolClient) => Promise<unknown>): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
      return 'OK';
    } catch (error) {
      await client.query('ROLLBACK');
      return sqlStateOf(error);
    } finally {
      client.release();
    }
  }

  function sqlStateOf(error: unknown): string {
    const candidate = error as { code?: unknown; sqlState?: unknown };
    if (typeof candidate.code === 'string') {
      return candidate.code;
    }
    return typeof candidate.sqlState === 'string' ? candidate.sqlState : 'UNKNOWN';
  }

  async function row(invitationId: string): Promise<{ status: string; version: string; successor_id: string | null; sealed: boolean; terminal: boolean } | undefined> {
    const result = await pool.query<{ status: string; version: string; successor_id: string | null; sealed: boolean; terminal: boolean }>(
      `SELECT status, version, successor_id, snapshot_sealed AS sealed, terminal_at IS NOT NULL AS terminal
         FROM app.admin_invitations WHERE invitation_id = $1::uuid`,
      [invitationId],
    );
    return result.rows[0];
  }

  async function permissionCount(invitationId: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.admin_invitation_permissions WHERE invitation_id = $1::uuid',
      [invitationId],
    );
    return result.rows[0]?.n ?? -1;
  }

  async function createCommitted(overrides: Partial<CreateInvitationInput> = {}): Promise<CreateInvitationInput> {
    const value = input(overrides);
    await manager().withTransaction((context) => participant.create(context, value));
    return value;
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 8 });
    await truncateInvitations();
    creatorId = await makeUser(true);
    otherCreatorId = await makeUser(true);
    acceptedUserId = await makeUser(false);
  });

  afterAll(async () => {
    try {
      await truncateInvitations();
      for (const phone of phonesToPurge) {
        await purgePhone(pool, phone);
      }
    } finally {
      await pool.end();
    }
  });

  describe('atomic create + sealed snapshot', () => {
    it('writes the invitation and its whole snapshot together, sealed, PENDING, version 1, with database time', async () => {
      const value = await createCommitted({
        ttlSeconds: 3600,
        permissions: [
          VIEW,
          { app: 'SHOP', canView: true, canReviewProfile: true, canLock: true },
          { app: 'DRIVER', canView: true, canReviewProfile: false, canLock: true },
        ],
      });
      const result = await pool.query<{ status: string; version: string; sealed: boolean; ttl: number; created_by: string; terminal_at: string | null }>(
        `SELECT status, version, snapshot_sealed AS sealed, extract(epoch FROM expires_at - created_at)::int AS ttl, created_by, terminal_at
           FROM app.admin_invitations WHERE invitation_id = $1::uuid`,
        [value.invitationId],
      );
      expect(result.rows).toEqual([
        { status: 'PENDING', version: '1', sealed: true, ttl: 3600, created_by: creatorId, terminal_at: null },
      ]);
      expect(await permissionCount(value.invitationId)).toBe(3);
    });

    it('stores a digest only: there is no column that can hold a plaintext token or secret', async () => {
      const columns = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name IN ('admin_invitations', 'admin_invitation_permissions')`,
      );
      const names = columns.rows.map((entry) => entry.column_name);
      expect(names).toContain('token_digest');
      expect(names.filter((name) => /token|secret|password|otp|code/i.test(name))).toEqual(['token_digest']);
    });

    it('a transaction that fails after the participant wrote leaves neither invitation nor permissions', async () => {
      const value = input({ permissions: [VIEW, { app: 'SHOP', canView: true, canReviewProfile: true, canLock: false }] });
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await participant.create(context, value);
          throw new Error('coordinator failed after the participant');
        }),
      );
      expect((failure as Error).message).toBe('coordinator failed after the participant');
      expect(await row(value.invitationId)).toBeUndefined();
      expect(await permissionCount(value.invitationId)).toBe(0);
    });

    it('a database failure while writing (duplicate token digest) leaves nothing of the new invitation and keeps the old one', async () => {
      const existing = await createCommitted();
      const value = input({ tokenDigest: existing.tokenDigest, permissions: [VIEW, { app: 'SHOP', canView: true, canReviewProfile: false, canLock: false }] });
      const failure = await failureOf(() => manager().withTransaction((context) => participant.create(context, value)));
      expect(sqlStateOf(failure)).toBe('23505');
      expect(await row(value.invitationId)).toBeUndefined();
      expect(await permissionCount(value.invitationId)).toBe(0);
      expect((await row(existing.invitationId))?.status).toBe('PENDING');
    });

    it('the participant sends no statement at all for a snapshot without VIEW (refused before the database)', async () => {
      const value = input({ permissions: [{ app: 'SHOP', canView: false, canReviewProfile: false, canLock: false }] });
      await failureOf(() => manager().withTransaction((context) => participant.create(context, value)));
      expect(await row(value.invitationId)).toBeUndefined();
    });
  });

  describe('permission rules in the database', () => {
    const CASES: ReadonlyArray<readonly [string, InvitationPermission]> = [
      ['REVIEW without VIEW', { app: 'SHOP', canView: false, canReviewProfile: true, canLock: false }],
      ['LOCK without VIEW', { app: 'DRIVER', canView: false, canReviewProfile: false, canLock: true }],
      ['CUSTOMER with REVIEW (even with VIEW)', { app: 'CUSTOMER', canView: true, canReviewProfile: true, canLock: false }],
      ['an unknown app', { app: 'ADMIN' as 'SHOP', canView: true, canReviewProfile: false, canLock: false }],
    ];
    for (const [label, permission] of CASES) {
      it(`rejects ${label} (23514)`, async () => {
        const state = await stateOf(async (client) => {
          const id = await insertRaw(client, rawRow());
          await insertRawPermission(client, id, permission);
        });
        expect(state).toBe('23514');
      });
    }

    it('accepts REVIEW and LOCK together with VIEW on SHOP and DRIVER, and LOCK with VIEW on CUSTOMER', async () => {
      const state = await stateOf(async (client) => {
        const id = await insertRaw(client, rawRow());
        await insertRawPermission(client, id, { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: true });
        await insertRawPermission(client, id, { app: 'SHOP', canView: true, canReviewProfile: true, canLock: true });
        await insertRawPermission(client, id, { app: 'DRIVER', canView: true, canReviewProfile: true, canLock: false });
      });
      expect(state).toBe('OK');
    });

    it('rejects a second row for the same app (primary key)', async () => {
      const state = await stateOf(async (client) => {
        const id = await insertRaw(client, rawRow());
        await insertRawPermission(client, id);
        await insertRawPermission(client, id);
      });
      expect(state).toBe('23505');
    });
  });

  describe('row shape (CHECK constraints)', () => {
    const BAD: ReadonlyArray<readonly [string, () => Partial<RawInvitation>]> = [
      ['a phone that is not +84 and nine digits', () => ({ phone_normalized: '+8491111111' })],
      ['a phone with a letter', () => ({ phone_normalized: '+8491111111a' })],
      ['a blank full name', () => ({ full_name: '   ' })],
      ['a 121 character full name', () => ({ full_name: 'x'.repeat(121) })],
      ['an upper-case digest', () => ({ token_digest: 'A'.repeat(64) })],
      ['a short digest', () => ({ token_digest: 'a'.repeat(63) })],
      ['an unknown status', () => ({ status: 'DELETED' })],
      ['version 0', () => ({ version: 0 })],
      ['expires_at equal to created_at', () => ({ created_at: "'2026-01-01T00:00:00Z'::timestamptz", expires_at: "'2026-01-01T00:00:00Z'::timestamptz" })],
      ['PENDING with terminal_at', () => ({ terminal_at: 'now()' })],
      ['PENDING with an accepted user', () => ({ accepted_user_id: acceptedUserId })],
      ['ACCEPTED without terminal_at and user', () => ({ status: 'ACCEPTED' })],
      ['ACCEPTED without a user', () => ({ status: 'ACCEPTED', terminal_at: 'now()' })],
      ['REVOKED without terminal_at', () => ({ status: 'REVOKED' })],
      ['REVOKED with an accepted user', () => ({ status: 'REVOKED', terminal_at: 'now()', accepted_user_id: acceptedUserId })],
      ['SUPERSEDED without a successor', () => ({ status: 'SUPERSEDED', terminal_at: 'now()' })],
      ['a successor on a non-SUPERSEDED row', () => ({ status: 'REVOKED', terminal_at: 'now()', successor_id: randomUUID() })],
    ];
    for (const [label, build] of BAD) {
      it(`rejects ${label} (23514)`, async () => {
        const state = await stateOf((client) => insertRaw(client, rawRow(build())));
        expect(state).toBe('23514');
      });
    }

    it('rejects a SUPERSEDED row that names itself as successor (23514)', async () => {
      const id = randomUUID();
      const state = await stateOf((client) =>
        insertRaw(client, rawRow({ invitation_id: id, status: 'SUPERSEDED', terminal_at: 'now()', successor_id: id })),
      );
      expect(state).toBe('23514');
    });

    it('rejects a duplicate generation_id and a duplicate token digest (23505)', async () => {
      const existing = await createCommitted();
      const generation = (await pool.query<{ generation_id: string }>('SELECT generation_id FROM app.admin_invitations WHERE invitation_id = $1::uuid', [existing.invitationId])).rows[0]?.generation_id as string;
      expect(await stateOf((client) => insertRaw(client, rawRow({ generation_id: generation })))).toBe('23505');
      expect(await stateOf((client) => insertRaw(client, rawRow({ token_digest: existing.tokenDigest })))).toBe('23505');
    });

    it('rejects a created_by that is not an administration member (23503)', async () => {
      const outsider = await makeUser(false);
      expect(await stateOf((client) => insertRaw(client, rawRow({ created_by: outsider })))).toBe('23503');
    });
  });

  describe('deferred validation at COMMIT', () => {
    it('commits an invitation with a valid sealed snapshot', async () => {
      const state = await commitState(async (client) => {
        const id = await insertRaw(client, rawRow());
        await insertRawPermission(client, id, { app: 'SHOP', canView: true, canReviewProfile: true, canLock: false });
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
      });
      expect(state).toBe('OK');
    });

    const FAILING: ReadonlyArray<readonly [string, (client: PoolClient, id: string) => Promise<void>]> = [
      ['no permission at all (sealed)', async (client, id) => void (await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]))],
      [
        'permissions without any VIEW (sealed)',
        async (client, id) => {
          await insertRawPermission(client, id, { app: 'SHOP', canView: false, canReviewProfile: false, canLock: false });
          await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
        },
      ],
      ['a VIEW permission but never sealed', async (client, id) => insertRawPermission(client, id)],
      ['nothing at all', async () => undefined],
    ];
    for (const [label, work] of FAILING) {
      it(`rolls everything back for ${label}`, async () => {
        const id = randomUUID();
        const state = await commitState(async (client) => {
          await insertRaw(client, rawRow({ invitation_id: id }));
          await work(client, id);
        });
        expect(state).toBe('23514');
        expect(await row(id)).toBeUndefined();
        expect(await permissionCount(id)).toBe(0);
      });
    }

    it('through the manager the rejected COMMIT is reported and nothing is left behind', async () => {
      const id = randomUUID();
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await repository.insert(context, { ...input({ invitationId: id }) });
          await repository.insertPermission(context, id, { app: 'SHOP', canView: false, canReviewProfile: false, canLock: false });
          await repository.seal(context, id);
        }),
      );
      expect(sqlStateOf(failure)).toBe('23514');
      expect(await row(id)).toBeUndefined();
      expect(await permissionCount(id)).toBe(0);
    });
  });

  describe('snapshot sealing', () => {
    it('allows permission inserts before the seal and refuses the first one after it (23001)', async () => {
      const state = await stateOf(async (client) => {
        const id = await insertRaw(client, rawRow());
        await insertRawPermission(client, id, { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false });
        await insertRawPermission(client, id, { app: 'SHOP', canView: true, canReviewProfile: false, canLock: false });
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
        await insertRawPermission(client, id, { app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false });
      });
      expect(state).toBe('23001');
    });

    it('a committed sealed snapshot cannot get an insert, an update or a delete, from any connection', async () => {
      const value = await createCommitted();
      expect(await stateOf((client) => insertRawPermission(client, value.invitationId, { app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false }))).toBe('23001');
      expect(await stateOf((client) => client.query('UPDATE app.admin_invitation_permissions SET can_lock = true WHERE invitation_id = $1::uuid', [value.invitationId]))).toBe('23001');
      expect(await stateOf((client) => client.query('DELETE FROM app.admin_invitation_permissions WHERE invitation_id = $1::uuid', [value.invitationId]))).toBe('23001');
      expect(await permissionCount(value.invitationId)).toBe(1);
    });

    it('refuses a permission for an invitation that does not exist (23001)', async () => {
      expect(await stateOf((client) => insertRawPermission(client, randomUUID()))).toBe('23001');
    });

    it('only one false -> true change of snapshot_sealed exists: not twice, not back, not with a version or status change', async () => {
      const unsealed = (client: PoolClient) => insertRaw(client, rawRow());
      expect(await stateOf(async (client) => {
        const id = await unsealed(client);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
      })).toBe('OK');
      expect(await stateOf(async (client) => {
        const id = await unsealed(client);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
      })).toBe('23001');
      expect(await stateOf(async (client) => {
        const id = await unsealed(client);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [id]);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = false WHERE invitation_id = $1::uuid', [id]);
      })).toBe('23001');
      expect(await stateOf(async (client) => {
        const id = await unsealed(client);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true, version = 2 WHERE invitation_id = $1::uuid', [id]);
      })).toBe('23001');
      expect(await stateOf(async (client) => {
        const id = await unsealed(client);
        await client.query("UPDATE app.admin_invitations SET snapshot_sealed = true, status = 'REVOKED', terminal_at = now(), version = 2 WHERE invitation_id = $1::uuid", [id]);
      })).toBe('23001');
    });

    it('an unsealed invitation cannot go terminal', async () => {
      expect(await stateOf(async (client) => {
        const id = await insertRaw(client, rawRow());
        await client.query("UPDATE app.admin_invitations SET status = 'REVOKED', terminal_at = now(), version = 2 WHERE invitation_id = $1::uuid", [id]);
      })).toBe('23001');
    });

    it('a late permission INSERT waits for the invitation row lock and is refused once the sealed row is visible', async () => {
      const value = await createCommitted();
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid FOR UPDATE', [value.invitationId]);
        const late = stateOf((client) =>
          insertRawPermission(client, value.invitationId, { app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false }),
        );
        await waitForBlockedBackends(pool);
        await holder.query('COMMIT');
        expect(await late).toBe('23001');
      } finally {
        holder.release();
      }
      expect(await permissionCount(value.invitationId)).toBe(1);
    });
  });

  describe('one PENDING invitation per phone', () => {
    it('two concurrent transactions for the same phone: exactly one commits, the other gets 23505 and leaves nothing', async () => {
      const phone = newPhone();
      const first = input({ phoneNormalized: phone });
      const second = input({ phoneNormalized: phone });
      const firstInserted = deferred();
      const releaseFirst = deferred();

      const a = manager().withTransaction(async (context) => {
        await participant.create(context, first);
        firstInserted.resolve();
        await releaseFirst.promise;
      });
      await firstInserted.promise;
      const b = manager()
        .withTransaction((context) => participant.create(context, second))
        .then(() => 'committed' as const, (error: unknown) => error);
      await waitForBlockedBackends(pool);
      releaseFirst.resolve();
      await a;
      const outcome = await b;

      expect(outcome).not.toBe('committed');
      expect(sqlStateOf(outcome)).toBe('23505');
      expect(await row(first.invitationId)).toMatchObject({ status: 'PENDING' });
      expect(await row(second.invitationId)).toBeUndefined();
      expect(await permissionCount(second.invitationId)).toBe(0);
      const pending = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.admin_invitations WHERE phone_normalized = $1 AND status = 'PENDING'", [phone]);
      expect(pending.rows[0]?.n).toBe(1);
    });

    it('if the first transaction rolls back, the waiting second one commits', async () => {
      const phone = newPhone();
      const first = input({ phoneNormalized: phone });
      const second = input({ phoneNormalized: phone });
      const firstInserted = deferred();
      const releaseFirst = deferred();

      const a = manager()
        .withTransaction(async (context) => {
          await participant.create(context, first);
          firstInserted.resolve();
          await releaseFirst.promise;
          throw new Error('first rolls back');
        })
        .catch((error: unknown) => error);
      await firstInserted.promise;
      const b = manager().withTransaction((context) => participant.create(context, second));
      await waitForBlockedBackends(pool);
      releaseFirst.resolve();
      expect(((await a) as Error).message).toBe('first rolls back');
      await b;

      expect(await row(first.invitationId)).toBeUndefined();
      expect(await row(second.invitationId)).toMatchObject({ status: 'PENDING', version: '1' });
    });

    it('an invitation past its expires_at but not yet terminal still occupies the phone, until the coordinator moves it', async () => {
      const phone = newPhone();
      const expiredId = randomUUID();
      const state = await commitState(async (client) => {
        await insertRaw(
          client,
          rawRow({ invitation_id: expiredId, phone_normalized: phone, created_at: "now() - interval '2 hours'", expires_at: "now() - interval '1 hour'" }),
        );
        await insertRawPermission(client, expiredId);
        await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [expiredId]);
      });
      expect(state).toBe('OK');

      const blocked = await failureOf(() => manager().withTransaction((context) => participant.create(context, input({ phoneNormalized: phone }))));
      expect(sqlStateOf(blocked)).toBe('23505');

      // The coordinator sees it under the lock, decides expiry with the DATABASE clock, moves it, then reuses the phone.
      const replacement = input({ phoneNormalized: phone });
      await manager().withTransaction(async (context) => {
        const found = await participant.lockPendingByPhone(context, phone);
        expect(found?.invitationId).toBe(expiredId);
        const clock = await context.query<{ ms: string }>("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms");
        expect(Number(clock.rows[0]?.ms)).toBeGreaterThan(found?.expiresAtMs ?? Number.MAX_SAFE_INTEGER);
        expect(await participant.transition(context, expiredId, found?.version ?? 0, { to: 'EXPIRED' })).toBe(2);
        await participant.create(context, replacement);
      });
      expect(await row(expiredId)).toMatchObject({ status: 'EXPIRED', version: '2', terminal: true });
      expect(await row(replacement.invitationId)).toMatchObject({ status: 'PENDING' });
    });

    it('a terminal invitation does not occupy the phone', async () => {
      const first = await createCommitted();
      await manager().withTransaction(async (context) => {
        await participant.transition(context, first.invitationId, 1, { to: 'REVOKED' });
      });
      await expect(createCommitted({ phoneNormalized: first.phoneNormalized })).resolves.toBeDefined();
    });
  });

  describe('reissue: old terminal, then the new PENDING, one transaction', () => {
    it('supersedes the old invitation and inserts the successor (deferred successor_id foreign key)', async () => {
      const old = await createCommitted({ permissions: [VIEW, { app: 'SHOP', canView: true, canReviewProfile: true, canLock: false }] });
      const successor = input({ phoneNormalized: old.phoneNormalized, createdBy: otherCreatorId, permissions: [{ app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false }] });
      await manager().withTransaction(async (context) => {
        const current = await participant.lockPendingByPhone(context, old.phoneNormalized);
        expect(current).toMatchObject({ invitationId: old.invitationId, version: 1, status: 'PENDING' });
        // Old first, naming a successor that does not exist yet; only then the successor.
        expect(await participant.transition(context, old.invitationId, 1, { to: 'SUPERSEDED', successorId: successor.invitationId })).toBe(2);
        await participant.create(context, successor);
      });
      expect(await row(old.invitationId)).toMatchObject({ status: 'SUPERSEDED', version: '2', successor_id: successor.invitationId, terminal: true, sealed: true });
      expect(await row(successor.invitationId)).toMatchObject({ status: 'PENDING', version: '1', sealed: true });
      expect(await permissionCount(old.invitationId)).toBe(2);
      expect(await permissionCount(successor.invitationId)).toBe(1);
    });

    it('inserting the successor BEFORE the old one is terminal is refused by the unique index', async () => {
      const old = await createCommitted();
      const successor = input({ phoneNormalized: old.phoneNormalized });
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await participant.create(context, successor);
          await participant.transition(context, old.invitationId, 1, { to: 'SUPERSEDED', successorId: successor.invitationId });
        }),
      );
      expect(sqlStateOf(failure)).toBe('23505');
      expect(await row(old.invitationId)).toMatchObject({ status: 'PENDING', version: '1', successor_id: null });
      expect(await row(successor.invitationId)).toBeUndefined();
    });

    it('rolls back to the old PENDING invitation when anything after the transition fails', async () => {
      const old = await createCommitted();
      const successor = input({ phoneNormalized: old.phoneNormalized });
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await participant.transition(context, old.invitationId, 1, { to: 'SUPERSEDED', successorId: successor.invitationId });
          await participant.create(context, successor);
          throw new Error('audit or idempotency failed');
        }),
      );
      expect((failure as Error).message).toBe('audit or idempotency failed');
      expect(await row(old.invitationId)).toMatchObject({ status: 'PENDING', version: '1', successor_id: null, terminal: false });
      expect(await row(successor.invitationId)).toBeUndefined();
      expect(await permissionCount(successor.invitationId)).toBe(0);
    });

    it('rolls back to the old PENDING invitation when the successor insert itself fails (duplicate digest)', async () => {
      const old = await createCommitted();
      const successor = input({ phoneNormalized: old.phoneNormalized, tokenDigest: old.tokenDigest });
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await participant.transition(context, old.invitationId, 1, { to: 'SUPERSEDED', successorId: successor.invitationId });
          await participant.create(context, successor);
        }),
      );
      expect(sqlStateOf(failure)).toBe('23505');
      expect(await row(old.invitationId)).toMatchObject({ status: 'PENDING', version: '1', successor_id: null });
    });

    it('a SUPERSEDED row whose successor never gets inserted fails the COMMIT (23503) and the old row stays PENDING', async () => {
      const old = await createCommitted();
      const failure = await failureOf(() =>
        manager().withTransaction(async (context) => {
          await participant.transition(context, old.invitationId, 1, { to: 'SUPERSEDED', successorId: randomUUID() });
        }),
      );
      expect(sqlStateOf(failure)).toBe('23503');
      expect(await row(old.invitationId)).toMatchObject({ status: 'PENDING', version: '1', successor_id: null });
    });
  });

  describe('terminal transitions, identity and version', () => {
    const TARGETS: ReadonlyArray<readonly [string, () => Parameters<AdminInvitationParticipant['transition']>[3]]> = [
      ['ACCEPTED', () => ({ to: 'ACCEPTED', acceptedUserId })],
      ['REVOKED', () => ({ to: 'REVOKED' })],
      ['EXPIRED', () => ({ to: 'EXPIRED' })],
      ['PHONE_CONFLICT', () => ({ to: 'PHONE_CONFLICT' })],
    ];
    for (const [status, change] of TARGETS) {
      it(`PENDING -> ${status} raises version by exactly one, sets terminal_at, and is final`, async () => {
        const value = await createCommitted();
        const next = await manager().withTransaction((context) => participant.transition(context, value.invitationId, 1, change()));
        expect(next).toBe(2);
        expect(await row(value.invitationId)).toMatchObject({ status, version: '2', terminal: true });

        // The participant finds no PENDING row any more.
        expect(await manager().withTransaction((context) => participant.transition(context, value.invitationId, 2, { to: 'REVOKED' }))).toBeUndefined();
        // And the database refuses every raw attempt to leave the terminal state or to touch its version.
        const raw = (sql: string) => stateOf((client) => client.query(sql, [value.invitationId]));
        expect(await raw("UPDATE app.admin_invitations SET status = 'PENDING', terminal_at = NULL, accepted_user_id = NULL, version = 3 WHERE invitation_id = $1::uuid")).toBe('23001');
        expect(await raw("UPDATE app.admin_invitations SET status = 'EXPIRED', accepted_user_id = NULL, terminal_at = now(), version = 3 WHERE invitation_id = $1::uuid")).toBe('23001');
        expect(await raw('UPDATE app.admin_invitations SET version = version + 1 WHERE invitation_id = $1::uuid')).toBe('23001');
        expect(await row(value.invitationId)).toMatchObject({ status, version: '2' });
      });
    }

    it('a stale expected version changes nothing', async () => {
      const value = await createCommitted();
      expect(await manager().withTransaction((context) => participant.transition(context, value.invitationId, 7, { to: 'REVOKED' }))).toBeUndefined();
      expect(await row(value.invitationId)).toMatchObject({ status: 'PENDING', version: '1', terminal: false });
    });

    const IDENTITY: ReadonlyArray<readonly [string, string, () => unknown]> = [
      ['invitation_id', 'invitation_id = $2::uuid', () => randomUUID()],
      ['generation_id', 'generation_id = $2::uuid', () => randomUUID()],
      ['phone_normalized', 'phone_normalized = $2', () => newPhone()],
      ['full_name', 'full_name = $2', () => 'Someone Else'],
      ['note', 'note = $2', () => 'changed'],
      ['token_digest', 'token_digest = $2', () => newDigest()],
      ['created_by', 'created_by = $2::uuid', () => otherCreatorId],
      ['created_at', "created_at = created_at - interval '1 minute'", () => null],
      ['expires_at', "expires_at = expires_at + interval '1 hour'", () => null],
    ];
    for (const [column, assignment, value] of IDENTITY) {
      it(`${column} is immutable (23001)`, async () => {
        const created = await createCommitted();
        const parameter = value();
        const state = await stateOf((client) =>
          client.query(
            `UPDATE app.admin_invitations SET ${assignment} WHERE invitation_id = $1::uuid`,
            parameter === null ? [created.invitationId] : [created.invitationId, parameter],
          ),
        );
        expect(state).toBe('23001');
      });
    }

    it('version can only grow by exactly one together with a terminal status (23001 otherwise)', async () => {
      const created = await createCommitted();
      const update = (set: string) => stateOf((client) => client.query(`UPDATE app.admin_invitations SET ${set} WHERE invitation_id = $1::uuid`, [created.invitationId]));
      expect(await update("status = 'REVOKED', terminal_at = now(), version = 3")).toBe('23001');
      expect(await update("status = 'REVOKED', terminal_at = now(), version = 1")).toBe('23001');
      expect(await update("status = 'REVOKED', terminal_at = now(), version = 2")).toBe('OK');
    });

    it('deleting an invitation is refused (23001) and nothing cascades', async () => {
      const created = await createCommitted();
      expect(await stateOf((client) => client.query('DELETE FROM app.admin_invitations WHERE invitation_id = $1::uuid', [created.invitationId]))).toBe('23001');
      expect(await row(created.invitationId)).toBeDefined();
      expect(await permissionCount(created.invitationId)).toBe(1);
      const rules = await pool.query<{ confdeltype: string }>(
        `SELECT DISTINCT confdeltype FROM pg_constraint
          WHERE contype = 'f' AND conrelid IN ('app.admin_invitations'::regclass, 'app.admin_invitation_permissions'::regclass)`,
      );
      expect(rules.rows).toEqual([{ confdeltype: 'a' }]);
    });

    it('a participant call from a closed transaction context is refused before the database', async () => {
      let leaked: TransactionContext | undefined;
      await manager().withTransaction(async (context) => {
        leaked = context;
      });
      const failure = await failureOf(() => participant.create(leaked as TransactionContext, input()));
      expect(failure).toBeInstanceOf(Error);
    });
  });
});
