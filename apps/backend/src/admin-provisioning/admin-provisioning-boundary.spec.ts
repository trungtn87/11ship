import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M01-D-ADMIN-1B, proven on the code with comments removed.

const FILES = readdirSync(sourcePath('admin-provisioning'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => `admin-provisioning/${name}`);
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('ADMIN invitation boundary (M01-D-ADMIN-1B)', () => {
  it('exposes exactly the eight contract routes under /admin', () => {
    const controller = codeOf('admin-provisioning/admin-provisioning.controller.ts');
    expect(controller).toContain("@Controller('admin')");
    const routes = [...controller.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1] as string} ${match[2] as string}`);
    expect(routes.sort()).toEqual(
      [
        'Post operations',
        'Post operations/:operation_id/verify',
        'Get operations/:operation_id',
        'Post invitations',
        'Get invitations',
        'Get invitations/:invitation_id',
        'Post invitations/:invitation_id/reissue',
        'Post invitations/:invitation_id/revoke',
      ].sort(),
    );
  });

  it('never logs and uses no non-CSPRNG randomness', () => {
    expect(ALL).not.toMatch(/\bconsole\./);
    expect(ALL).not.toMatch(/\bLogger\b/);
    expect(ALL).not.toMatch(/Math\.random/);
  });

  it('adds no dependency: every import is relative, node: or @nestjs/common', () => {
    const imports = [...ALL.matchAll(/from '([^']+)'/g)].map((match) => match[1] as string);
    for (const source of imports) {
      expect(source.startsWith('.') || source.startsWith('node:') || source === '@nestjs/common').toBe(true);
    }
  });

  it('issues SQL only from the operation repository, the invitation reader and the lock helper', () => {
    for (const file of FILES) {
      if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(codeOf(file))) {
        expect(file).toMatch(/admin-operation-repository\.ts$|admin-invitation-reader\.ts$|admin-provisioning-locks\.ts$/);
      }
    }
    expect(ALL).not.toMatch(/DELETE FROM/);
  });

  it('writes invitations only through the 1A participant (never its own INSERT/UPDATE on admin_invitations)', () => {
    expect(ALL).not.toMatch(/INSERT INTO app\.admin_invitations/);
    expect(ALL).not.toMatch(/UPDATE app\.admin_invitations/);
    expect(ALL).not.toMatch(/admin_invitation_permissions\s*\(/);
  });

  it('sets no cookie and has no Set-Cookie in the 1B adapter', () => {
    expect(codeOf('admin-provisioning/admin-provisioning.controller.ts')).not.toMatch(/Set-Cookie/i);
  });

  it('every non-executor 1B transaction sets lock_timeout before its first lock (Owner decision)', () => {
    for (const file of ['admin-provisioning/admin-operation-service.ts', 'admin-provisioning/admin-invitation-service.ts']) {
      const code = codeOf(file);
      const transactions = code.split('this.transactions.withTransaction(async').slice(1);
      for (const body of transactions) {
        const timeout = body.indexOf('setBusinessLockTimeout(');
        const firstLock = body.search(/\.(lock|lockShared|lockBuckets|peekTarget)\(/);
        expect(timeout).toBeGreaterThanOrEqual(0);
        expect(timeout).toBeLessThan(firstLock);
      }
    }
  });
});
