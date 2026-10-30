import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M05, proven on the code with comments removed.

const FILES = readdirSync(sourcePath('customers'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
  .map((name) => `customers/${name}`);

describe('Customer address book boundary (M05)', () => {
  it('exposes the address book, independent defaults, and place search routes', () => {
    const controller = codeOf('customers/customers.controller.ts');
    expect(controller).toContain("@Controller('customers/me')");
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\([^)]*\)/g)).toEqual([
      "@Get()",
      "@Get('addresses')",
      "@Post('addresses')",
      "@Patch('addresses/:addressId')",
      "@Delete('addresses/:addressId')",
      "@Put('addresses/:addressId/default')",
      "@Get('places')",
      "@Put('addresses/:addressId/defaults/:kind')",
      "@Delete('addresses/:addressId/defaults/:kind')",
    ]);
  });

  it('is guarded and takes identity only from the principal', () => {
    const controller = codeOf('customers/customers.controller.ts');
    expect(controller).toContain('@UseGuards(SessionAuthGuard)');
    expect(controller).toContain('request.auth');
    expect(controller.match(/@Param\('(\w+)'\)/g)).toEqual([
      "@Param('addressId')", "@Param('addressId')", "@Param('addressId')",
      "@Param('addressId')", "@Param('kind')", "@Param('addressId')", "@Param('kind')",
    ]);
    expect(controller).not.toMatch(/userId|customerId|driverId|user_id|customer_id|driver_id/);
  });

  it('issues no SQL outside the repository and never touches the pool', () => {
    for (const file of FILES.filter((name) => !name.endsWith('customers-repository.ts'))) {
      expect(codeOf(file)).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b\s|app\.\w+|DATABASE_POOL|from 'pg'|\.query\(/);
    }
  });

  it('every address statement of the repository is scoped by customer_id and nothing is physically deleted', () => {
    const repository = codeOf('customers/customers-repository.ts');
    expect(repository).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\b/i);
    for (const statement of repository.match(/(?:SELECT|UPDATE|INSERT)[^`]*?app\.customer_addresses[^`]*/g) ?? []) {
      expect(statement).toMatch(/customer_id/);
    }
  });

  it('every write goes through the idempotency executor: four writes, four executions, no outbox event', () => {
    const service = codeOf('customers/customers-service.ts');
    expect(service.split('this.executor.execute(').length - 1).toBe(4);
    expect(service).not.toMatch(/OutboxWriter|outbox\.append/);
  });

  it('the readers open a read transaction (FOR SHARE) and write no address', () => {
    const service = codeOf('customers/customers-service.ts');
    const reads = service.slice(service.indexOf('async readCustomer('), service.indexOf('async createAddress('));
    expect(reads).toContain("'share'");
    expect(reads).not.toMatch(/insertAddress|updateFields|softDelete|markDefault|clearDefault|executor/);
  });

  it('keeps the lock order of every write: user and session (authority), role, customer row, address row, write, audit', () => {
    const service = codeOf('customers/customers-service.ts');
    const update = service.slice(service.indexOf('async updateAddress('), service.indexOf('async deleteAddress('));
    const order = [
      "this.authority.lock(context, principal, 'update')",
      'this.#requireCustomerRole(',
      'this.#lockCustomerId(',
      'this.customers.lockActiveAddress(',
      'this.customers.updateFields(',
      'this.#audit(',
    ].map((marker) => update.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const create = service.slice(service.indexOf('async createAddress('), service.indexOf('async updateAddress('));
    const createOrder = [
      "this.authority.lock(context, principal, 'update')",
      'this.#requireCustomerRole(',
      'this.#ensureCustomer(',
      'this.customers.insertAddress(',
      'this.#audit(',
    ].map((marker) => create.indexOf(marker));
    expect(createOrder.every((index) => index >= 0)).toBe(true);
    expect([...createOrder].sort((a, b) => a - b)).toEqual(createOrder);
  });

  it('a default switch clears the old default before it sets the new one, in the same transaction', () => {
    const service = codeOf('customers/customers-service.ts');
    const setDefault = service.slice(service.indexOf('async setDefaultAddress('), service.indexOf('#replayPolicy(principal: AuthPrincipal)'));
    expect(setDefault.indexOf('this.customers.clearDefault(')).toBeGreaterThan(-1);
    expect(setDefault.indexOf('this.customers.clearDefault(')).toBeLessThan(setDefault.indexOf('this.customers.markDefault('));
  });

  it('the replay hook re-authorizes the session and the role and writes nothing', () => {
    const service = codeOf('customers/customers-service.ts');
    const hook = service.slice(service.indexOf('#replayPolicy(principal: AuthPrincipal)'), service.indexOf('async #requireCustomerRole('));
    expect(hook).toContain("this.authority.lock(context, principal, 'update')");
    expect(hook).toContain('this.#requireCustomerRole(');
    expect(hook).not.toMatch(/insert|update[A-Z]|softDelete|markDefault|clearDefault|audit/i);
  });

  it('never touches the order, the account, the login, the roles or the profile name', () => {
    const all = FILES.map((file) => codeOf(file)).join('\n');
    expect(all).not.toMatch(/grantRole|insertProfileIfAbsent|updateFullName|password|OtpProvider|app\.orders|app\.sessions/i);
  });
});
