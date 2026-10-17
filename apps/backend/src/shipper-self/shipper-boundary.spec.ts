import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M03 (Shipper management), proven on the code with comments removed.

function filesIn(directory: string): string[] {
  return readdirSync(sourcePath(directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${directory}/${name}`);
}

const codeIn = (directory: string): string => filesIn(directory).map((file) => codeOf(file)).join('\n');

describe('Shipper own endpoints boundary (M03)', () => {
  it('exposes exactly the documented routes, all behind the session guard, none with a path parameter', () => {
    const controller = codeOf('shipper-self/shipper-self.controller.ts');
    expect(controller).toContain('@UseGuards(SessionAuthGuard)');
    expect(controller).toContain("@Controller('driver')");
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\('[^']*'\)/g)).toEqual([
      "@Get('me')",
      "@Get('banks')",
      "@Get('wallet-limits')",
      "@Put('me/profile')",
      "@Put('me/bank')",
      "@Post('me/submit')",
      "@Post('me/accepting')",
      "@Post('me/closure-request')",
      "@Post('me/closure-cancel')",
    ]);
    expect(controller).not.toMatch(/@Param|driverId|driver_id|user_id|userId/);
  });

  it('no Shipper-facing code names the internal classification or sends it', () => {
    for (const code of [codeIn('shipper-self'), codeOf('driver/shipper-view.ts')]) {
      expect(code).not.toMatch(/driver_type|driverType|PLATFORM|EXTERNAL/);
    }
    // The administration views are the only ones that read it.
    expect(codeOf('admin-shippers/admin-shipper-service.ts')).toContain('driver_type: driver.driverType');
  });

  it('writes only through the idempotency executor, once per command shell, and never issues SQL itself', () => {
    const service = codeOf('shipper-self/shipper-self-service.ts');
    expect(service.split('this.executor.execute(').length - 1).toBe(1);
    expect(codeIn('shipper-self')).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|\bBEGIN\b|COMMIT|ROLLBACK/);
    expect(service.indexOf('this.authority.lock(context, principal')).toBeLessThan(service.indexOf('this.drivers.lockByUserId('));
  });

  it('has no settings, parameter or system-configuration route (the minimums are an administration function; the app only gets a hint)', () => {
    expect(codeIn('shipper-self')).not.toMatch(/system[-_]settings|SystemSettings|updateWalletParameters|saveWalletParameters/i);
  });
});

describe('Shipper administration boundary (M03)', () => {
  it('every command route sits behind the administration transport, never behind the client session', () => {
    const controller = codeOf('admin-shippers/admin-shipper.controller.ts');
    expect(controller).not.toMatch(/SessionAuthGuard|AuthPrincipal/);
    expect(controller).toContain("@Controller('admin/shippers')");
    expect(controller).toContain("@Controller('admin/system-settings/shipper-wallet')");
    expect(controller.match(/@Post\((?:'[^']*')?\)/g)).toEqual([
      "@Post(':driver_id/approve')",
      "@Post(':driver_id/reject')",
      "@Post(':driver_id/lock')",
      "@Post(':driver_id/unlock')",
      "@Post(':driver_id/classification')",
      "@Post(':driver_id/bank/verify')",
      "@Post(':driver_id/bank/reject')",
      "@Post(':driver_id/closure/reject')",
      "@Post(':driver_id/closure/finalize')",
      '@Post()',
    ]);
  });

  it('there is no route to add a Shipper or to delete one, and no body can name the actor or the new status', () => {
    const controller = codeOf('admin-shippers/admin-shipper.controller.ts');
    expect(controller).not.toMatch(/@(Put|Delete|Patch)\(/);
    const validation = codeOf('admin-shippers/admin-shipper-validation.ts');
    // The only 'status' a request may carry is the LIST filter (a query); no command body has a status, actor or user.
    expect(validation).not.toMatch(/'actor|actor_id|user_id/);
    expect(validation.match(/onlyKeys\(source, \[[^\]]*\]/g)?.join(' ')).not.toMatch(/status|actor|user/);
  });

  it('the SQL stays in the Driver module: the administration services issue none', () => {
    expect(codeIn('admin-shippers')).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|app\.\w+/);
  });

  it('every command refuses the administrator\'s own Shipper profile, after the permission and before any change', () => {
    const service = codeOf('admin-shippers/admin-shipper-service.ts');
    const body = service.slice(service.indexOf('async (context) => {'));
    const order = ['this.#authorize(context, known, RIGHT[command])', 'this.drivers.lockById(', "'DRIVER_SELF_ACTION_FORBIDDEN'", 'driver.version !== input.expectedVersion', 'this.#apply('].map((marker) => body.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the wallet parameters are SYSTEM only: the permission check is the SYSTEM assertion, not a DRIVER permission row', () => {
    const service = codeOf('admin-shippers/shipper-wallet-parameters-service.ts');
    expect(service).toContain('this.actor.assertLive(locked, nowMs)');
    expect(service).not.toMatch(/permissions\(|canReviewProfile|canLock/);
  });
});
