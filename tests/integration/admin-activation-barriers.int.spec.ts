import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { adminData, adminErrorCode, totpNow } from './support/admin-fixtures';
import {
  act,
  advance,
  ActivationApp,
  attemptsOf,
  getState,
  insertAttempt,
  invitationStatus,
  newInvite,
  ok,
  post,
  startActivationApp,
} from './support/activation-fixtures';
import { holdRowLock, waitForBlockedBackends, waitUntilDbClockPast } from './support/lock-fixtures';
import { randomPhone } from './support/auth-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C: deterministic barriers on the real PostgreSQL. The test holds a lock on its own connection, sends the
// request, waits until the request is really blocked, lets the DATABASE clock pass an expiry (or ends the competing
// transaction), then releases. No sleep orders anything.

describe('M01-D-ADMIN-1C - barriers: users unique, expiry after the locks', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const deps = (): { app: ActivationApp['app']; provider: ActivationApp['provider'] } => ({ app: ctx.app, provider: ctx.provider });

  beforeAll(async () => {
    ctx = await startActivationApp();
    system = await systemSession(ctx.app);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.app.clearLimits();
    ctx.provider.clear();
  });

  async function holdUserInsert(phone: string): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
    const client = await ctx.pool.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), phone, await new Argon2idPasswordHasher().hash('Another-Passw0rd-1')],
    );
    const end = async (statement: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
      try {
        await client.query(statement);
      } finally {
        client.release();
      }
    };
    return { commit: () => end('COMMIT'), rollback: () => end('ROLLBACK') };
  }

  it('K2: complete waits for a competing registration of the same phone; if it commits the activation is a PHONE_CONFLICT, nothing half-made', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const competing = await holdUserInsert(invite.phone.normalized);
    const pending = post(app, '/complete', session, { code: totpNow(String(secret)) });
    await waitForBlockedBackends(pool);
    await competing.commit();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(adminErrorCode(response)).toBe('ADMIN_PHONE_CONFLICT');
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PHONE_CONFLICT');
    expect((await attemptsOf(pool, invite.invitationId)).map((row) => [row.status, row.invalidated_reason])).toEqual([['INVALIDATED', 'PHONE_CONFLICT']]);
    const members = await pool.query('SELECT 1 FROM app.admin_memberships m JOIN app.users u ON u.user_id = m.user_id WHERE u.phone_normalized = $1', [
      invite.phone.normalized,
    ]);
    expect(members.rowCount).toBe(0);
    const users = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    expect(users.rowCount).toBe(1);
  });

  it('K2: when the competing registration rolls back, the waiting complete succeeds with exactly one account', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const competing = await holdUserInsert(invite.phone.normalized);
    const pending = post(app, '/complete', session, { code: totpNow(String(secret)) });
    await waitForBlockedBackends(pool);
    await competing.rollback();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(adminData(response)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    const users = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    expect(users.rowCount).toBe(1);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('K15: a request that waits for the attempt lock past expires_at is a 401 and writes nothing (T is read after the last lock)', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const brief = await insertAttempt(pool, { invitationId: invite.invitationId, status: 'STARTED', createdAgoSeconds: 60, expiresInSeconds: 3 });
    const state = adminData(ok(await getState(app, { cookie: brief.cookie, csrf: '' })));
    const session = { cookie: brief.cookie, csrf: String(state.csrf_token) };
    const held = await holdRowLock(pool, 'SELECT 1 FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid FOR UPDATE', [brief.attemptId]);
    const audits = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n);
    const pending = post(app, '/otp/request', session);
    await waitForBlockedBackends(pool);
    await waitUntilDbClockPast(pool, 'SELECT expires_at FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid', [brief.attemptId]);
    await held.release();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_SESSION_INVALID');
    expect(ctx.provider.sendStarted()).toBe(0);
    const challenges = await pool.query('SELECT 1 FROM app.admin_activation_otp_challenges WHERE attempt_id = $1::uuid', [brief.attemptId]);
    expect(challenges.rowCount).toBe(0);
    expect(Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n)).toBe(audits);
  });

  it('K16: a start that waits for the invitation lock past invitation.expires_at is the uniform 404 and creates no attempt', async () => {
    const { app, pool } = ctx;
    const phone = randomPhone();
    app.track(phone.normalized);
    const token = generateToken();
    const invitationId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app.admin_invitations
           (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by,
            created_at, expires_at, snapshot_sealed)
         VALUES ($1::uuid, $2::uuid, $3, 'Short Lived', NULL, $4, 'PENDING', 1, $5::uuid,
                 now() - interval '1 hour', now() + interval '3 seconds', false)`,
        [invitationId, randomUUID(), phone.normalized, token.digest, system.account.userId],
      );
      await client.query(
        `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock)
         VALUES ($1::uuid, 'SHOP', true, false, false)`,
        [invitationId],
      );
      await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [invitationId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const held = await holdRowLock(pool, 'SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid FOR UPDATE', [invitationId]);
    const pending = act(app, 'POST', '/start', { body: { token: token.token } });
    await waitForBlockedBackends(pool);
    await waitUntilDbClockPast(pool, 'SELECT expires_at FROM app.admin_invitations WHERE invitation_id = $1::uuid', [invitationId]);
    await held.release();
    const response = await pending;
    expect(response.status).toBe(404);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    expect(response.setCookie).toEqual([]);
    expect(await attemptsOf(pool, invitationId)).toEqual([]);
  });

  // ----- complete: expiry re-checked AFTER the wait on users.phone_normalized -----------------------------------------------

  async function auditTotal(): Promise<number> {
    return Number((await ctx.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n);
  }

  type Ending = 'rollback' | 'commit';

  async function nothingMade(phone: string, invitationId: string, ending: Ending): Promise<void> {
    const { pool } = ctx;
    // Only the competing registration may own a user (when it committed); nothing of the activation survived either.
    expect((await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone])).rowCount).toBe(ending === 'commit' ? 1 : 0);
    expect((await pool.query('SELECT 1 FROM app.admin_memberships m JOIN app.users u ON u.user_id = m.user_id WHERE u.phone_normalized = $1', [phone])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM app.admin_profiles WHERE invitation_id = $1::uuid', [invitationId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM app.admin_totp_factors f JOIN app.admin_activation_attempts a ON a.factor_id = f.factor_id WHERE a.invitation_id = $1::uuid", [invitationId])).rowCount).toBe(0);
    const attempts = await attemptsOf(pool, invitationId);
    expect(attempts.map((row) => [row.status, row.totp_attempt_count])).toEqual([['TOTP_ISSUED', 0]]);
  }

  it.each(['rollback', 'commit'] as const)('K30 (attempt expiry): complete waits at the users INSERT behind a registration, the DB clock passes attempt.expires_at, the registration then ends with %s - 401, never PHONE_CONFLICT, nothing invalidated or audited', async (ending) => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const row = await insertAttempt(pool, { invitationId: invite.invitationId, status: 'PASSWORD_SET', createdAgoSeconds: 5, expiresInSeconds: 7 });
    const state = adminData(ok(await getState(app, { cookie: row.cookie, csrf: '' })));
    const session = { cookie: row.cookie, csrf: String(state.csrf_token) };
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    const competing = await holdUserInsert(invite.phone.normalized);
    const audits = await auditTotal();
    const pending = post(app, '/complete', session, { code: totpNow(secret) });
    await waitForBlockedBackends(pool); // complete is parked ON the unique index, after it already read T
    await waitUntilDbClockPast(pool, 'SELECT expires_at FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid', [row.attemptId]);
    await competing[ending]();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_SESSION_INVALID');
    await nothingMade(invite.phone.normalized, invite.invitationId, ending);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PENDING');
    expect(await auditTotal()).toBe(audits);
  });

  it.each(['rollback', 'commit'] as const)('K30 (invitation expiry): same schedule, the INVITATION expires while complete waits, the registration ends with %s - the uniform 404, never PHONE_CONFLICT, nothing made', async (ending) => {
    const { app, pool } = ctx;
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitationId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app.admin_invitations
           (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by,
            created_at, expires_at, snapshot_sealed)
         VALUES ($1::uuid, $2::uuid, $3, 'Short Lived', NULL, $4, 'PENDING', 1, $5::uuid,
                 now() - interval '1 hour', now() + interval '7 seconds', false)`,
        [invitationId, randomUUID(), phone.normalized, generateToken().digest, system.account.userId],
      );
      await client.query(
        `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock)
         VALUES ($1::uuid, 'SHOP', true, false, false)`,
        [invitationId],
      );
      await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [invitationId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const row = await insertAttempt(pool, { invitationId, status: 'PASSWORD_SET', createdAgoSeconds: 5, expiresInSeconds: 600 });
    const state = adminData(ok(await getState(app, { cookie: row.cookie, csrf: '' })));
    const session = { cookie: row.cookie, csrf: String(state.csrf_token) };
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    const competing = await holdUserInsert(phone.normalized);
    const audits = await auditTotal();
    const pending = post(app, '/complete', session, { code: totpNow(secret) });
    await waitForBlockedBackends(pool);
    await waitUntilDbClockPast(pool, 'SELECT expires_at FROM app.admin_invitations WHERE invitation_id = $1::uuid', [invitationId]);
    await competing[ending]();
    const response = await pending;
    expect(response.status).toBe(404);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    await nothingMade(phone.normalized, invitationId, ending);
    expect(await invitationStatus(pool, invitationId)).toBe('PENDING');
    expect(await auditTotal()).toBe(audits);
  });

  it('K30 (control): the same schedule WITHOUT an expiry still completes - the re-check only refuses what really expired', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const competing = await holdUserInsert(invite.phone.normalized);
    const pending = post(app, '/complete', session, { code: totpNow(String(secret)) });
    await waitForBlockedBackends(pool);
    await competing.rollback();
    expect((await pending).status).toBe(200);
  });
});
