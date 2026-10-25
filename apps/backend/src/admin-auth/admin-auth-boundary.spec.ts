import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M01-D-LOGIN, proven on the code with comments removed.

function filesOf(directory: string): string[] {
  return readdirSync(sourcePath(directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${directory}/${name}`);
}

const FILES = [...filesOf('admin-auth'), ...filesOf('admin-auth/cli')];
const ALL = FILES.map((file) => codeOf(file)).join('\n');

describe('Administration authentication boundary (M01-D-LOGIN)', () => {
  it('exposes exactly seven routes under /admin-auth', () => {
    const controller = codeOf('admin-auth/admin-auth.controller.ts');
    expect(controller).toContain("@Controller('admin-auth')");
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\(/g)).toEqual([
      '@Post(', '@Get(', '@Post(', '@Post(', '@Post(', '@Get(', '@Post(',
    ]);
  });

  it('uses only the CSPRNG for secrets and tokens: no Math.random, no Date-based randomness', () => {
    expect(ALL).not.toMatch(/Math\.random/);
    expect(ALL).not.toMatch(/\bnew Date\(\)\.get/);
  });

  it('never logs: no console, no Logger, no process.stdout outside the CLI output port', () => {
    expect(ALL).not.toMatch(/\bconsole\./);
    expect(ALL).not.toMatch(/\bLogger\b/);
    expect(ALL).not.toMatch(/process\.stdout|process\.stderr/);
  });

  it('adds no dependency of its own: every import is relative, node:, @nestjs/common or pg', () => {
    const imports = [...ALL.matchAll(/from '([^']+)'/g)].map((match) => match[1] as string);
    for (const source of imports) {
      expect(source.startsWith('.') || source.startsWith('node:') || source === '@nestjs/common' || source === 'pg').toBe(true);
    }
  });

  it('keeps Auth Core private: only the narrow admin ports are imported from auth/', () => {
    const authImports = [...ALL.matchAll(/from '\.\.\/(?:\.\.\/)?auth\/([^']+)'/g)].map((match) => match[1] as string);
    const allowed = new Set([
      'admin-identity-participant',
      'admin-password-verifier',
      'admin-session-revocation-participant',
      'auth-db',
      'auth-validation',
      // Issue #117: the SMS OTP limits are a SYSTEM parameter group; the admin module wires the repository that owns that table.
      'otp-policy-repository',
      'password-hasher',
      'phone',
      'tokens',
      'user-repository',
    ]);
    for (const name of authImports) {
      expect(allowed.has(name)).toBe(true);
    }
  });

  it('issues SQL only from the repositories, the CLI target queries and the bootstrap advisory lock', () => {
    const sqlFiles = FILES.filter((file) => /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(codeOf(file)));
    expect(codeOf('admin-auth/admin-bootstrap-service.ts').match(/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/g)).toEqual(['SELECT']);
    for (const file of sqlFiles) {
      expect(file).toMatch(/repository\.ts$|admin-auth-cli\.ts$|admin-bootstrap-service\.ts$|system-recovery-cli\.ts$/);
    }
    // The local recovery CLI issues exactly one statement: the connected database/role identity check.
    expect(codeOf('admin-auth/cli/system-recovery-cli.ts').match(/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/g)).toEqual(['SELECT']);
  });

  it('sets cookies only through the cookie builder (Secure, HttpOnly, SameSite=Strict, no Domain)', () => {
    const cookies = codeOf('admin-auth/admin-cookies.ts');
    expect(cookies).toContain('Secure');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=Strict');
    expect(cookies).not.toMatch(/Domain=/);
    expect(codeOf('admin-auth/admin-auth.controller.ts')).not.toMatch(/Set-Cookie['"],\s*`/);
  });
});
