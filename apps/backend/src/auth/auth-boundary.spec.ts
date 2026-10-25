import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M01-A1, proven on the code with comments removed. They complement the behavioural specs:
// what Auth may and may not depend on, where the expensive and external calls sit, and that nothing secret can
// reach a log.

function authFiles(): string[] {
  return readdirSync(sourcePath('auth'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `auth/${name}`);
}

function allAuthCode(): string {
  return authFiles().map((file) => codeOf(file)).join('\n');
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('dependencies (task section 3)', () => {
  it('keeps the explicit backend dependency set: Auth adds argon2 and Business Dashboard adds Web Push', () => {
    const manifest = JSON.parse(readFileSync(sourcePath('../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express',
      'argon2',
      'pg',
      'reflect-metadata',
      'rxjs',
      'web-push', // Business Dashboard: standard encrypted Web Push, outside Auth.
    ]);
    expect(manifest.dependencies.argon2).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/); // exact, no range
  });

  it('imports none of the forbidden libraries anywhere in Auth', () => {
    expect(allAuthCode()).not.toMatch(
      /from '(jsonwebtoken|jose|bcrypt|bcryptjs|scrypt-js|passport[^']*|class-validator|class-transformer|zod|joi|yup|redis|ioredis|typeorm|prisma|@prisma[^']*|sequelize|knex|libphonenumber[^']*|google-libphonenumber|uuid|@nestjs\/jwt)'/,
    );
  });

  it('only password-hasher.ts imports argon2', () => {
    for (const file of authFiles()) {
      const imports = /from 'argon2'/.test(codeOf(file));
      expect([file, imports]).toEqual([file, file === 'auth/password-hasher.ts']);
    }
  });

  it('never uses Math.random: every secret comes from the CSPRNG', () => {
    expect(allAuthCode()).not.toMatch(/Math\.random/);
    expect(codeOf('auth/otp.ts')).toContain('randomInt');
    expect(codeOf('auth/tokens.ts')).toContain('randomBytes');
  });
});

describe('nothing secret can be logged', () => {
  it('Auth code never writes to a console, stream or logger', () => {
    const code = allAuthCode();
    expect(code).not.toMatch(/console\.|process\.std(out|err)|\.log\(|logger|Logger|APP_LOGGER/);
  });

  it('the fake provider is the only code that sees the OTP besides the service that generates it', () => {
    const holders = authFiles().filter((file) => /sendRegisterOtp/.test(codeOf(file)));
    // M00-D2: the DisabledOtpProvider (staging fixture mode) implements the port too, but its method declares NO
    // parameter, so it can never read the phone number or the OTP it is called with; it only fails.
    expect(holders.sort()).toEqual([
      'auth/disabled-otp-provider.ts',
      'auth/fake-otp-provider.ts',
      'auth/otp-provider.ts',
      'auth/verification-service.ts',
    ]);
    expect(codeOf('auth/disabled-otp-provider.ts')).toMatch(/async sendRegisterOtp\(\): Promise<void>/);
    expect(codeOf('auth/disabled-otp-provider.ts')).not.toMatch(/phoneNormalized|console|\blog/i);
  });
});

describe('where the expensive and external calls sit', () => {
  it('the OTP provider is called from exactly one place, never from a repository', () => {
    const service = codeOf('auth/verification-service.ts');
    expect(occurrences(service, 'this.provider.sendRegisterOtp')).toBe(1);
    for (const file of authFiles().filter((name) => name.endsWith('-repository.ts'))) {
      expect(codeOf(file)).not.toMatch(/provider|Provider/);
    }
    // The provider call sits in its own helper, outside the withTransaction callbacks of requestOtp.
    expect(service).toMatch(/#deliver\(phoneNormalized, otp, \{/);
    expect(service.indexOf('await this.#deliver(')).toBeGreaterThan(service.indexOf('insertPendingDelivery'));
  });

  it('register hashes before the idempotency executor; login verifies before its session transaction', () => {
    const registration = codeOf('auth/registration-service.ts');
    expect(registration.indexOf('this.hasher.hash(')).toBeGreaterThan(-1);
    expect(registration.indexOf('this.hasher.hash(')).toBeLessThan(registration.indexOf('this.executor.execute('));
    expect(registration.indexOf('findIdByDigest')).toBeLessThan(registration.indexOf('this.hasher.hash('));
    expect(occurrences(registration, 'this.hasher.hash(')).toBe(1);

    const login = codeOf('auth/login-service.ts');
    const secondTransaction = login.indexOf('withTransaction', login.indexOf('withTransaction') + 1);
    expect(login.indexOf('this.hasher.verify(')).toBeGreaterThan(-1);
    expect(login.indexOf('this.hasher.verify(')).toBeLessThan(secondTransaction);
    expect(login.indexOf('verifyAgainstDummy')).toBeLessThan(secondTransaction);
  });

  it('services take transaction contexts from the coordinators: nothing in Auth touches the pool or opens its own connection', () => {
    const code = allAuthCode();
    expect(code).not.toMatch(/DATABASE_POOL|from 'pg'|new Pool|\.connect\(|BEGIN|COMMIT|ROLLBACK/);
  });

  it('repositories contain parameterized SQL only: nothing but the two fixed fragments is interpolated', () => {
    for (const file of authFiles().filter((name) => name.endsWith('-repository.ts'))) {
      const interpolations = codeOf(file).match(/\$\{[^}]*\}/g) ?? [];
      const unexpected = interpolations.filter((i) => !/^\$\{(epochMs\('[a-z_]+'\)|CLOCK_CTE)\}$/.test(i));
      expect([file, unexpected]).toEqual([file, []]);
    }
  });
});

describe('what Auth does not own', () => {
  it('has no Shop, Driver, Wallet, Order or Delivery code or table references', () => {
    expect(allAuthCode()).not.toMatch(/app\.(shops?|drivers?|wallets?|orders?|deliver\w*)\b/i);
  });

  it('never issues or reads a refresh token, and has no logout-all, password reset or phone change', () => {
    // Issue #102: Auth owns the RESET_PASSWORD OTP purpose and its request/verify engine (the reset itself lives in account-recovery/).
    const withoutResetOtp = allAuthCode().replace(/RESET_PASSWORD(?:_PURPOSE)?|[A-Za-z]*ResetOtp/g, '');
    expect(withoutResetOtp).not.toMatch(/refresh[_ ]?token|logout|reset[_ ]?password|change[_ ]?phone|forgot/i);
  });

  it('has no CAPTCHA, Redis or external limiter: the OTP limits are the PostgreSQL policy (issue #117)', () => {
    // The OTP request quotas (shared cooldown, phone hour/day, client address hour) are SYSTEM parameters read from PostgreSQL and
    // reserved atomically with the challenge. Nothing else limits here: no Redis, no CAPTCHA.
    expect(allAuthCode()).not.toMatch(/throttle|captcha|redis/i);
  });

  it('only the binding file imports the fake provider among production files', () => {
    const importers = readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
      .filter((name) => /fake-otp-provider/.test(codeOf(name)))
      .map((name) => name.replace(/\\/g, '/'));
    expect(importers.sort()).toEqual(['auth/otp-provider-binding.ts']);
  });

  it('AppModule takes Auth only as an explicit option and main.ts binds the provider through bindOtpProvider', () => {
    expect(codeOf('app.module.ts')).toMatch(/auth\?: AuthModuleOptions/);
    expect(codeOf('app.module.ts')).not.toMatch(/Fake|FakeOtpProvider|OTP_PROVIDER/);
    expect(codeOf('main.ts')).toContain('bindOtpProvider(config.appEnv, {');
    expect(codeOf('main.ts')).not.toMatch(/FakeOtpProvider/);
    expect(codeOf('auth/auth.module.ts')).not.toMatch(/FakeOtpProvider|useClass/);
    // Issue #102: the real adapter is reached only through the explicit SMS_GATEWAY binding that bindOtpProvider returns.
    expect(codeOf('auth/auth.module.ts').match(/useExisting/g)?.length ?? 0).toBe(1);
    expect(codeOf('auth/auth.module.ts')).toMatch(/isSmsGatewayBinding\(options\.otpProvider\)\s*\?\s*\{ provide: OTP_PROVIDER, useExisting: SmsGatewayOtpProvider \}/);
  });

  it('uses the M00 modules instead of recreating them', () => {
    const module = codeOf('auth/auth.module.ts');
    for (const name of ['TransactionModule', 'IdempotencyModule', 'AuditModule', 'OutboxModule']) {
      expect(module).toContain(name);
    }
    const code = allAuthCode();
    expect(code).not.toMatch(/class \w*(Idempotency|AuditWriter|OutboxWriter|TransactionManager)\w*/);
  });
});
