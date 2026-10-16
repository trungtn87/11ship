import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of the USER lock / unlock (M01-ADMIN, D15), proven on the code with comments removed.

const FILES = readdirSync(sourcePath('admin-account-lock'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => `admin-account-lock/${name}`);
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('administration account lock boundary', () => {
  it('exposes exactly the three POST routes (lock, unlock, delete), under /v1/admin/users/:user_id', () => {
    const controller = codeOf('admin-account-lock/admin-account-lock.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1] as string} ${match[2] as string}`);
    expect(routes.sort()).toEqual(['Post users/:user_id/delete', 'Post users/:user_id/lock', 'Post users/:user_id/unlock']);
    expect(controller).toContain("@Controller('admin')");
  });

  it('only the SESSION cookie is read: no preauth cookie, no Bearer, no Set-Cookie', () => {
    expect(ALL).toContain('ADMIN_SESSION_COOKIE');
    expect(ALL).not.toMatch(/PREAUTH|authorization|Bearer|Set-Cookie/i);
  });

  it('writes no SQL of its own: users and sessions stay behind the Auth participant', () => {
    // Statement shapes, not bare words: the policy names the action DELETE, which is not SQL.
    expect(ALL).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bSELECT\b[^;]*\bFROM\b|FOR (UPDATE|SHARE)|context\.query/);
  });

  it('the command runs inside the idempotency executor and writes audit + outbox in the same callback', () => {
    const service = codeOf('admin-account-lock/admin-account-lock-service.ts');
    expect(service).toContain('this.executor.execute(');
    expect(service).toContain('this.audit.append(context');
    expect(service).toContain('this.outbox.append(context');
    expect(service.indexOf('this.executor.execute(')).toBeLessThan(service.indexOf('this.audit.append('));
  });

  it('takes the target from the path and the actor from the session: the body never names a status, a role or an actor', () => {
    const validation = codeOf('admin-account-lock/admin-account-lock-validation.ts');
    expect(validation).toContain("'expected_version'");
    expect(validation).toContain("'reason'");
    expect(validation).not.toMatch(/'status'|'roles'|'actor/);
  });

  it('never logs or stores a cookie, a token or a password', () => {
    expect(ALL).not.toMatch(/\bconsole\.|\bLogger\b|password|digest/i);
  });
});
