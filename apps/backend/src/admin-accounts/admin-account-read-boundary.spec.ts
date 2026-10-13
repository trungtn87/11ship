import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of the account read (M01-ADMIN account read), proven on the code with comments removed.

const FILES = readdirSync(sourcePath('admin-accounts'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => `admin-accounts/${name}`);
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('administration account read boundary', () => {
  it('exposes exactly four GET routes and no write route', () => {
    const controller = codeOf('admin-accounts/admin-account-read.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1] as string} ${match[2] as string}`);
    expect(routes.sort()).toEqual(['Get administrators', 'Get permissions', 'Get users', 'Get users/:user_id']);
    expect(controller).toContain("@Controller('admin')");
    expect(controller).toContain("@Controller('admin-auth')");
  });

  it('only the SESSION cookie is read: no preauth cookie, no Bearer, no Set-Cookie', () => {
    expect(ALL).toContain('ADMIN_SESSION_COOKIE');
    expect(ALL).not.toMatch(/PREAUTH|authorization|Bearer|Set-Cookie/i);
  });

  it('reads only: no INSERT, UPDATE, DELETE or lock clause, no audit, no outbox, no idempotency', () => {
    expect(ALL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b|FOR (UPDATE|SHARE)/);
    expect(ALL).not.toMatch(/AuditWriter|Outbox|IdempotencyExecutor|audit\.append/);
  });

  it('never selects a credential, a secret or a full phone into a response column', () => {
    const repository = codeOf('admin-accounts/admin-account-read-repository.ts');
    expect(repository).not.toMatch(/password|otp|proof|totp|token|digest|bank|pickup_lat|pickup_lng|address_text/i);
    const service = codeOf('admin-accounts/admin-account-read-service.ts');
    expect(service).toContain('maskPhone(');
    expect(service).not.toMatch(/phone_normalized|phoneNormalized\s*[,:]/);
  });

  it('interpolates nothing into SQL except fixed fragments', () => {
    const interpolations = codeOf('admin-accounts/admin-account-read-repository.ts').match(/\$\{[^}]*\}/g) ?? [];
    for (const item of interpolations) {
      expect(item).toMatch(/^\$\{(US|USER_BASE|SHOP_OWNER_JOIN|epochMs\('[a-z_.]+'\))\}$/);
    }
  });

  it('adds no dependency: every import is relative, node: or @nestjs/common', () => {
    const imports = [...ALL.matchAll(/from '([^']+)'/g)].map((match) => match[1] as string);
    for (const source of imports) {
      expect(source.startsWith('.') || source.startsWith('node:') || source === '@nestjs/common').toBe(true);
    }
    expect(ALL).not.toMatch(/\bconsole\.|\bLogger\b|Math\.random/);
  });

  it('every read sets lock_timeout before its first lock', () => {
    const service = codeOf('admin-accounts/admin-account-read-service.ts');
    expect(service.indexOf('setBusinessLockTimeout(')).toBeGreaterThanOrEqual(0);
    expect(service.indexOf('setBusinessLockTimeout(')).toBeLessThan(service.indexOf('this.actor.lock('));
  });
});
