import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M01-D-ADMIN-1C, proven on the code with comments removed.

const FILES = readdirSync(sourcePath('admin-activation'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => `admin-activation/${name}`);
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('ADMIN activation boundary (M01-D-ADMIN-1C)', () => {
  it('exposes exactly the eight contract routes under /admin-activation', () => {
    const controller = codeOf('admin-activation/admin-activation.controller.ts');
    expect(controller).toContain('@Controller(ACTIVATION_ROUTE_PREFIX)');
    expect(codeOf('admin-activation/admin-activation-constants.ts')).toContain("ACTIVATION_ROUTE_PREFIX = 'admin-activation'");
    const routes = [...controller.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1] as string} ${match[2] as string}`);
    expect(routes.sort()).toEqual(
      ['Post start', 'Post restart', 'Get state', 'Post otp/request', 'Post otp/verify', 'Post password', 'Post totp/enrollment', 'Post complete'].sort(),
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

  it('issues SQL only from the activation repository', () => {
    for (const file of FILES) {
      if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(codeOf(file))) {
        expect(file).toMatch(/admin-activation-repository\.ts$/);
      }
    }
    expect(ALL).not.toMatch(/DELETE FROM/);
  });

  it('does not write invitations itself: the invitation changes only through the 1A participant', () => {
    expect(ALL).not.toMatch(/INSERT INTO app\.admin_invitations/);
    expect(ALL).not.toMatch(/UPDATE app\.admin_invitations/);
  });

  it('only the controller sets cookies; the service never touches Set-Cookie', () => {
    expect(codeOf('admin-activation/admin-activation-service.ts')).not.toMatch(/Set-Cookie/i);
    expect(codeOf('admin-activation/admin-activation-cookies.ts')).toContain('HttpOnly');
    expect(codeOf('admin-activation/admin-activation-cookies.ts')).toContain('SameSite=Strict');
    expect(codeOf('admin-activation/admin-activation-cookies.ts')).toContain('Secure');
  });

  it('has no SMS adapter and no automatic fallback to a fake provider', () => {
    const providers = codeOf('admin-activation/activation-otp-providers.ts');
    // Only the two named test modes bind a provider; everything else (SMS) falls through to a startup refusal.
    expect(providers).toMatch(/otpMode === 'FAKE'[\s\S]*otpMode === 'TEST_DISPLAY'[\s\S]*throw new StartupConfigError\(\['ADMIN_ACTIVATION_OTP_MODE'\]\)/);
    expect(codeOf('app.module.ts')).toMatch(/activationOtpProvider === undefined/);
  });

  it('the one business transaction helper sets lock_timeout before the caller takes any lock', () => {
    const service = codeOf('admin-activation/admin-activation-service.ts');
    const run = service.slice(service.indexOf('async #run'));
    expect(run.indexOf('setBusinessLockTimeout(')).toBeGreaterThanOrEqual(0);
    expect(run.indexOf('setBusinessLockTimeout(')).toBeLessThan(run.indexOf('work(context)'));
  });

  it('invitation writers take the invitation lock exclusively and readers share it', () => {
    const service = codeOf('admin-activation/admin-activation-service.ts');
    expect(service).toMatch(/this\.invitations\.lock\(/);
    expect(service).toMatch(/this\.reader\.lockShared\(/);
  });
});
