import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of the M01-A2S module split, proven on the code with comments removed.

function filesOf(directory: string): string[] {
  return readdirSync(sourcePath(directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${directory}/${name}`);
}

function codeIn(directory: string): string {
  return filesOf(directory)
    .map((file) => codeOf(file))
    .join('\n');
}

describe('Shop (M02) module boundary', () => {
  it('imports nothing from Auth or Onboarding and imports no Nest module: Auth -> Shop stays one-way', () => {
    const code = codeIn('shop');
    expect(code).not.toMatch(/from '\.\.\/(auth|onboarding)\//);
    expect(codeOf('shop/shop.module.ts')).not.toMatch(/imports:/);
  });

  it('never opens, commits or rolls back a transaction and never touches the pool', () => {
    expect(codeIn('shop')).not.toMatch(/DATABASE_POOL|from 'pg'|new Pool|\.connect\(|BEGIN|COMMIT|ROLLBACK|TransactionManager/);
  });

  it('has no Driver, Wallet, Order or Delivery references and no business-hours or menu tables', () => {
    expect(codeIn('shop')).not.toMatch(/app\.(drivers?|driver_\w+|wallets?|orders?|deliver\w*|business_hours|menu\w*)\b/i);
  });

  it('interpolates nothing but the fixed clock fragment into SQL', () => {
    for (const file of filesOf('shop').filter((name) => name.endsWith('-repository.ts'))) {
      const interpolations = codeOf(file).match(/\$\{[^}]*\}/g) ?? [];
      expect([file, interpolations.filter((i) => i !== '${CLOCK_CTE}')]).toEqual([file, []]);
    }
  });

  it('the eligibility reader only reads: no INSERT, UPDATE, DELETE or lock clause', () => {
    expect(codeOf('shop/shop-eligibility-reader.ts')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b|FOR (UPDATE|SHARE)/);
  });

  it('only the Shop module issues SQL against its three tables', () => {
    const outside = readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
      .map((name) => name.replace(/\\/g, '/'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
      .filter((name) => !name.startsWith('shop/'))
      // The one read-only projection of the administration web (M01-ADMIN account read), pinned by its own boundary spec.
      .filter((name) => name !== 'admin-accounts/admin-account-read-repository.ts')
      .filter((name) => /app\.(service_areas|shops|shop_members)\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });
});

describe('Onboarding coordinator boundary', () => {
  it('never uses forwardRef anywhere in production code', () => {
    const all = readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
      .map((name) => name.replace(/\\/g, '/'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
      .filter((name) => /forwardRef/.test(codeOf(name)));
    expect(all).toEqual([]);
  });

  it('Auth does not import Onboarding, and Onboarding imports Auth only for the guard, the participants, the CUSTOMER role read of the service-area list and two pure helpers', () => {
    const authFiles = filesOf('auth').filter((file) => /from '\.\.\/onboarding\//.test(codeOf(file)));
    expect(authFiles).toEqual([]);
    const imports = codeIn('onboarding').match(/from '\.\.\/auth\/[^']+'/g) ?? [];
    // Besides the guard and the participants (role grant, session authorization), the strict body parsers reuse Auth's text and phone helpers.
    // The service-area list (read side) also asks the user repository whether the caller holds the CUSTOMER role.
    expect([...new Set(imports)].sort()).toEqual([
      "from '../auth/auth-constants'",
      "from '../auth/auth-principal'",
      "from '../auth/auth-validation'",
      "from '../auth/phone'",
      "from '../auth/role-grant-participant'",
      "from '../auth/session-auth.guard'",
      "from '../auth/session-authorization-participant'",
      "from '../auth/user-repository'",
    ]);
  });

  it('issues no SQL itself: it composes repositories and participants inside the executor transaction', () => {
    const code = codeIn('onboarding');
    expect(code).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|BEGIN|COMMIT|ROLLBACK/);
    // Commands never open a transaction of their own. The exceptions are the two read sides (resume, and the list of
    // ACTIVE service areas), which have no idempotency record to run under: only those files may name the transaction manager.
    const openers = filesOf('onboarding').filter((file) => /TransactionManager|withTransaction/.test(codeOf(file)));
    expect([...openers].sort()).toEqual(['onboarding/shop-profile-query-service.ts', 'onboarding/shop-service-area-query-service.ts']);
  });

  it('the read side is one read: a single transaction, a single M02 query, no executor, audit, outbox or role grant', () => {
    const query = codeOf('onboarding/shop-profile-query-service.ts');
    expect(query.split('withTransaction(').length - 1).toBe(1);
    expect(query.split('this.shops.').length - 1).toBe(1);
    expect(query).toContain('this.shops.findOwnedShop(');
    expect(query).not.toMatch(/Idempotency|AuditWriter|OutboxWriter|RoleGrantParticipant|ServiceAreaRepository|lockOwnedShop/);

    const controller = codeOf('onboarding/shop-onboarding.controller.ts');
    const read = controller.slice(controller.indexOf("@Get('profile')"), controller.indexOf("@Put('profile')"));
    expect(read).toContain('this.profiles.ownedProfile(principal.userId)');
    expect(read).not.toMatch(/idempotency|@Body|this\.onboarding\./i);
  });

  it('the service-area list is one read: a single transaction, the client session authority, the CUSTOMER role and one M02 read; no executor, audit, outbox or role grant', () => {
    const query = codeOf('onboarding/shop-service-area-query-service.ts');
    expect(query.split('withTransaction(').length - 1).toBe(1);
    expect(query.split('this.serviceAreas.').length - 1).toBe(1);
    expect(query).toContain('this.serviceAreas.listActive(context)');
    expect(query).toContain("this.authority.lock(context, principal, 'share')");
    expect(query).not.toMatch(/Idempotency|AuditWriter|OutboxWriter|RoleGrantParticipant|lockShared|lockOwnedShop|FOR (UPDATE|SHARE)/);

    const controller = codeOf('onboarding/shop-onboarding.controller.ts');
    const read = controller.slice(controller.indexOf("@Get('service-areas')"), controller.indexOf('#principal(request: AuthenticatedRequest)'));
    expect(read).toContain('this.serviceAreas.activeChoices(');
    expect(read).toContain('rejectQueryAndBody(request, query)');
    expect(read).not.toMatch(/idempotency|@Body|this\.onboarding\./i);
  });

  it('the active-area read of M02 is one plain statement: only ACTIVE rows, a stable order, no lock and no write', () => {
    const repository = codeOf('shop/service-area-repository.ts');
    const list = repository.slice(repository.indexOf('async listActive('));
    expect(list.split('context.query').length - 1).toBe(1);
    expect(list).toMatch(/WHERE status = 'ACTIVE'\s+ORDER BY name ASC, service_area_id ASC/);
    expect(list).not.toMatch(/FOR (UPDATE|SHARE)|\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('M02 reads the owned shop in ONE joined statement that takes no lock', () => {
    const repository = codeOf('shop/shop-repository.ts');
    const find = repository.slice(repository.indexOf('async findOwnedShop('), repository.indexOf('async insertDraft('));
    expect(find.split('context.query').length - 1).toBe(1);
    expect(find).toMatch(/FROM app\.shop_members m\s+JOIN app\.shops s ON s\.shop_id = m\.shop_id/);
    expect(find).not.toMatch(/FOR (UPDATE|SHARE)|\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('writes the profile and completion only through the M00 idempotency executor', () => {
    const service = codeOf('onboarding/shop-onboarding-service.ts');
    expect(service.split('this.executor.execute(').length - 1).toBe(2);
  });

  it('the Shop onboarding files have no Driver, Wallet, bank, approval, order or delivery code', () => {
    // Narrowed by M01-A2D: the onboarding directory now also holds the Driver coordinator (see
    // driver/driver-boundary.spec.ts for what that one may and may not contain). The A2S files keep the
    // original rule unchanged.
    const shopCode = filesOf('onboarding')
      .filter((file) => file.startsWith('onboarding/shop-'))
      .map((file) => codeOf(file))
      .join('\n');
    expect(shopCode).not.toMatch(/driver|wallet|bank|approv|topup|withdraw|deliver|menu|business_hours/i);
  });

  it('AppModule builds Auth once and hands the same object to Onboarding', () => {
    const app = codeOf('app.module.ts');
    // AdminAuthModule.register(auth) re-uses the same object; only ONE Auth Core is ever built.
    expect(app.match(/(?<![A-Za-z])AuthModule\.register\(/g)).toHaveLength(1);
    expect(app).toContain('OnboardingModule.register(auth)');
  });
});
