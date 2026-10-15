import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { prepareAuditEntry } from '../audit/audit-entry';
import { UserRepository } from '../auth/user-repository';
import { SessionRepository } from '../auth/session-repository';
import { IdempotencyExecutor } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { TransactionContext } from '../transaction/transaction-context';
import { ClientSessionAuthority } from './client-session-authority';
import { ClientPasswordService } from './client-password-service';

function fixture() {
  const context = {} as TransactionContext;
  const principal = { userId: randomUUID(), sessionId: randomUUID(), activeRole: 'CUSTOMER', phoneNormalized: '+84901234567' };
  let stored = 'hash:old-password';
  let changed = 0;
  let revoked = 0;
  let audited = 0;
  let concurrentReset = false;
  let app = 'FOOD';
  const service = new ClientPasswordService(
    { withTransaction: async (run: (c: TransactionContext) => unknown) => run(context) } as unknown as TransactionManager,
    { execute: async (_: unknown, run: (c: TransactionContext) => unknown) => run(context) } as unknown as IdempotencyExecutor,
    { lock: async () => ({ ...principal, app }) } as unknown as ClientSessionAuthority,
    { findById: async () => ({ passwordHash: stored }), setPasswordHash: async (_: unknown, input: { passwordHash: string }) => { stored = input.passwordHash; changed++; return 2; } } as unknown as UserRepository,
    { revokeOthersForUser: async (_: unknown, userId: string, sessionId: string) => { expect(userId).toBe(principal.userId); expect(sessionId).toBe(principal.sessionId); revoked++; return 1; } } as unknown as SessionRepository,
    { append: async (_: unknown, entry: Parameters<AuditWriter['append']>[1]) => { prepareAuditEntry(entry); expect(JSON.stringify(entry)).not.toContain('password-secret'); audited++; } } as unknown as AuditWriter,
    { hash: async (password) => `hash:${password}`, verify: async (hash, password) => { if (concurrentReset) stored = 'hash:reset-password'; return hash === `hash:${password}`; }, verifyAgainstDummy: async () => undefined },
  );
  return { service, principal, setApp: (value: string) => { app = value; }, resetDuringVerification: () => { concurrentReset = true; }, counters: () => ({ changed, revoked, audited, stored }) };
}

describe('Food own-password mutation', () => {
  it('refuses incorrect current password without changing credentials or sessions', async () => {
    const f = fixture();
    await expect(f.service.change(f.principal, { currentPassword: 'wrong', newPassword: 'new-password-secret' }, randomUUID(), randomUUID())).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    expect(f.counters()).toMatchObject({ changed: 0, revoked: 0, audited: 0 });
  });
  it('cannot overwrite a concurrent reset verified against an obsolete hash', async () => {
    const f = fixture(); f.resetDuringVerification();
    await expect(f.service.change(f.principal, { currentPassword: 'old-password', newPassword: 'new-password-secret' }, randomUUID(), randomUUID())).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    expect(f.counters()).toMatchObject({ changed: 0, revoked: 0, stored: 'hash:reset-password' });
  });
  it('writes the new hash, revokes other sessions and produces a valid secret-free audit', async () => {
    const f = fixture();
    await expect(f.service.change(f.principal, { currentPassword: 'old-password', newPassword: 'new-password-secret' }, randomUUID(), randomUUID())).resolves.toEqual({ data: { changed: true } });
    expect(f.counters()).toEqual({ changed: 1, revoked: 1, audited: 1, stored: 'hash:new-password-secret' });
  });
  it('does not expose the new feature to Ship sessions', async () => {
    const f = fixture(); f.setApp('SHIP');
    await expect(f.service.change(f.principal, { currentPassword: 'old-password', newPassword: 'new-password-secret' }, randomUUID(), randomUUID())).rejects.toMatchObject({ code: 'ROLE_NOT_AVAILABLE' });
    expect(f.counters()).toMatchObject({ changed: 0, revoked: 0, audited: 0 });
  });
});
