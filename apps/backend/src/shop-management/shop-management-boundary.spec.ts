import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M02-A, proven on the code with comments removed (A09, A16 and the lock order of A10-A12).

function filesOf(directory: string): string[] {
  return readdirSync(sourcePath(directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${directory}/${name}`);
}

const MANAGEMENT = filesOf('shop-management').map((file) => codeOf(file)).join('\n');
const NEW_SHOP_FILES = [
  'shop/business-hours.ts',
  'shop/shop-availability-reader.ts',
  'shop/shop-availability-sql.ts',
  'shop/shop-business-hours-repository.ts',
];

describe('Shop management boundary (M02-A)', () => {
  it('exposes exactly three routes: GET /, PUT profile, PUT business-hours', () => {
    const controller = codeOf('shop-management/shop-management.controller.ts');
    expect(controller).toContain("@Controller('shop/me')");
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\(/g)).toEqual(['@Get(', '@Put(', '@Put(']);
    expect(controller).toContain("@Put('profile')");
    expect(controller).toContain("@Put('business-hours')");
  });

  it('has no accepting-orders switch anywhere in the new code', () => {
    const code = [MANAGEMENT, ...NEW_SHOP_FILES.map((file) => codeOf(file))].join('\n');
    expect(code).not.toMatch(/accepting/i);
    expect(code).not.toMatch(/weekday\s*[=:]\s*0\b/);
  });

  it('is guarded and takes identity only from the principal', () => {
    const controller = codeOf('shop-management/shop-management.controller.ts');
    expect(controller).toContain('@UseGuards(SessionAuthGuard)');
    expect(controller).toContain('actorOf(principal)');
    expect(controller).not.toMatch(/@Param|@Query/);
  });

  it('issues no SQL itself and never touches the pool', () => {
    expect(MANAGEMENT).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b\s|app\.\w+|DATABASE_POOL|from 'pg'|\.query\(/);
  });

  it('writes only through the M00 idempotency executor, once per mutation', () => {
    const service = codeOf('shop-management/shop-management-service.ts');
    expect(service.split('this.executor.execute(').length - 1).toBe(2);
    expect(service.split('this.transactions.withTransaction(').length - 1).toBe(1);
  });

  it('keeps the lock order: user -> session -> OWNER membership/shop -> service area -> writes -> audit -> outbox', () => {
    const service = codeOf('shop-management/shop-management-service.ts');
    const profile = service.slice(service.indexOf('async #updateProfile('), service.indexOf('async #replaceBusinessHours('));
    const order = [
      'lockAuthorizedShopActor(',
      '#lockWritableShop(',
      'serviceAreas.lockShared(',
      'shops.updateActiveProfile(',
      '#record(',
    ].map((marker) => profile.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const hours = service.slice(service.indexOf('async #replaceBusinessHours('), service.indexOf('async #lockWritableShop('));
    const hoursOrder = ['lockAuthorizedShopActor(', '#lockWritableShop(', 'hours.replaceAll(', 'shops.advanceVersion(', '#record('].map(
      (marker) => hours.indexOf(marker),
    );
    expect(hoursOrder.every((index) => index >= 0)).toBe(true);
    expect([...hoursOrder].sort((a, b) => a - b)).toEqual(hoursOrder);

    const record = service.slice(service.indexOf('async #record('), service.indexOf('async #authorizeReplay('));
    expect(record.indexOf('this.audit.append(')).toBeLessThan(record.indexOf('this.outbox.append('));
  });

  it('the replay hook authorizes the session before it looks at the shop', () => {
    const service = codeOf('shop-management/shop-management-service.ts');
    const hook = service.slice(service.indexOf('async #authorizeReplay('));
    expect(hook.indexOf('lockAuthorizedShopActor(')).toBeGreaterThanOrEqual(0);
    expect(hook.indexOf('lockAuthorizedShopActor(')).toBeLessThan(hook.indexOf('lockOwnedShop('));
  });

  it('imports Auth only for the guard, the principal and the session participant', () => {
    const imports = MANAGEMENT.match(/from '\.\.\/auth\/[^']+'/g) ?? [];
    expect([...new Set(imports)].sort()).toEqual([
      "from '../auth/auth-principal'",
      "from '../auth/phone'",
      "from '../auth/session-auth.guard'",
      "from '../auth/session-authorization-participant'",
    ]);
  });

  it('contains no Menu, Order, Driver, Wallet or admin code', () => {
    expect(MANAGEMENT).not.toMatch(/driver|wallet|\bmenu|\border\b|admin|sms/i);
  });
});

describe('Availability statement (M02-A section 5)', () => {
  const sql = codeOf('shop/shop-availability-sql.ts');

  it('samples the clock once in a MATERIALIZED CTE and nowhere else', () => {
    expect(sql.split("'clock_timestamp()'").length - 1).toBe(1);
    expect(sql).toContain('WITH clock AS MATERIALIZED');
    expect(sql).toContain('local_time AS MATERIALIZED');
    expect(sql).not.toMatch(/\bnow\(\)|CURRENT_TIMESTAMP|statement_timestamp|transaction_timestamp|Date\.now|new Date/i);
  });

  it('works on Asia/Ho_Chi_Minh wall time and the ISO week', () => {
    expect(sql).toContain("'Asia/Ho_Chi_Minh'");
    expect(sql).toContain("date_trunc('week'");
  });

  it('is built from a fixed clock fragment and never reads the legacy column', () => {
    expect(sql).not.toContain('accepting_orders');
    expect(codeOf('shop/shop-availability-reader.ts')).not.toMatch(/INSERT|UPDATE|DELETE|FOR (UPDATE|SHARE)/);
  });

  it('the business-hours repository owns the table; no other module touches it', () => {
    const outside = readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
      .map((name) => name.replace(/\\/g, '/'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
      .filter((name) => !name.startsWith('shop/'))
      .filter((name) => /shop_business_hours/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });
});
