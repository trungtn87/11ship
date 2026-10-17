import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M01.05, proven on the code with comments removed.

const FILES = readdirSync(sourcePath('customer-profile'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
  .map((name) => `customer-profile/${name}`);
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('Own-profile read model boundary (M01.05)', () => {
  it('exposes exactly GET and PUT customer/me/profile', () => {
    const customer = codeOf('customer-profile/customer-profile.controller.ts');
    expect(customer).toContain("@Controller('customer/me/profile')");
    expect(customer.match(/@(Get|Put|Post|Patch|Delete)\(/g)).toEqual(['@Get(', '@Put(']);
  });

  it('is guarded and takes identity only from the principal: no path parameter, no id in a body or query', () => {
    for (const file of ['customer-profile/customer-profile.controller.ts']) {
      const code = codeOf(file);
      expect(code).toContain('@UseGuards(SessionAuthGuard)');
      expect(code).toContain('request.auth');
      expect(code).not.toMatch(/@Param|userId|driverId|user_id|driver_id/);
    }
  });

  it('issues no SQL itself and never touches the pool', () => {
    expect(ALL).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b\s|app\.\w+|DATABASE_POOL|from 'pg'|\.query\(/);
  });

  it('writes through the idempotency executor once and emits no outbox event', () => {
    const service = codeOf('customer-profile/customer-profile-service.ts');
    expect(service.split('this.executor.execute(').length - 1).toBe(1);
    expect(ALL).not.toMatch(/OutboxWriter|outbox\.append/);
  });

  it('the reader opens a read transaction and writes nothing: no executor, audit or update', () => {
    const service = codeOf('customer-profile/customer-profile-service.ts');
    const read = service.slice(service.indexOf('async read('), service.indexOf('async update('));
    expect(read).toContain("'share'");
    expect(read).not.toMatch(/audit|updateFullName|lockProfile|executor/);
  });

  it('keeps the lock order of PUT: user and session (authority), role, profile row, write, audit', () => {
    const service = codeOf('customer-profile/customer-profile-service.ts');
    const update = service.slice(service.indexOf('async #update('), service.indexOf('async #authorizeReplay('));
    const order = [
      "this.authority.lock(context, principal, 'update')",
      'this.#requireCustomer(',
      'this.customers.lockProfile(',
      'this.customers.updateFullName(',
      'this.audit.append(',
    ].map((marker) => update.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the replay hook re-authorizes the session and the role and does not compare the version or write', () => {
    const service = codeOf('customer-profile/customer-profile-service.ts');
    const hook = service.slice(service.indexOf('async #authorizeReplay('), service.indexOf('async #requireCustomer('));
    expect(hook).toContain("this.authority.lock(context, principal, 'update')");
    expect(hook).toContain('this.#requireCustomer(');
    expect(hook).not.toMatch(/version|updateFullName|audit|lockProfile/i);
  });

  it('never touches the driver legal name, bank data, consent, roles or onboarding', () => {
    expect(ALL).not.toMatch(/grantRole|insertProfileIfAbsent|insertConsentIfAbsent|insertPending|bank|consent/i);
  });
});
