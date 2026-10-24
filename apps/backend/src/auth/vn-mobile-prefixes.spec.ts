import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { normalizeVietnamMobile } from './phone';
import { VN_MOBILE_PREFIXES } from './vn-mobile-prefixes.generated';

// Jest runs from the repository root (npm run test:unit).
const ROOT = process.cwd();
const data = JSON.parse(readFileSync(join(ROOT, 'config/vn-mobile-prefixes.json'), 'utf8')) as {
  reviewedOn: string;
  verification: { status: string; note: string };
  prefixes: Array<{ prefix: string; operator: string; kind: string }>;
};

describe('central Vietnam mobile prefix table (issue #117)', () => {
  it('the generated backend and Dart tables match config/vn-mobile-prefixes.json (run `node scripts/gen-vn-mobile-prefixes.mjs` after editing it)', () => {
    expect(() => execFileSync(process.execPath, [join(ROOT, 'scripts/gen-vn-mobile-prefixes.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
    expect([...VN_MOBILE_PREFIXES]).toEqual(data.prefixes.map((entry) => entry.prefix).sort());
  });

  it('every entry is a national prefix with a leading 0, there are no duplicates and no prefix contains another', () => {
    for (const prefix of VN_MOBILE_PREFIXES) {
      expect(prefix).toMatch(/^0[3-9][0-9]{1,8}$/);
    }
    expect(new Set(VN_MOBILE_PREFIXES).size).toBe(VN_MOBILE_PREFIXES.length);
    for (const a of VN_MOBILE_PREFIXES) {
      for (const b of VN_MOBILE_PREFIXES) {
        expect(a !== b && b.startsWith(a)).toBe(false);
      }
    }
  });

  it('records the review date and says honestly whether the official allocation text was confirmed', () => {
    expect(data.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(['CONFIRMED_OFFICIAL', 'PENDING_OFFICIAL_CONFIRMATION']).toContain(data.verification.status);
    expect(data.verification.note.length).toBeGreaterThan(20);
    for (const entry of data.prefixes) {
      expect(['MNO', 'MVNO']).toContain(entry.kind);
      expect(entry.operator.length).toBeGreaterThan(0);
    }
  });

  it('covers the major operators and the virtual networks', () => {
    const operators = new Set(data.prefixes.map((entry) => entry.operator));
    for (const name of ['Viettel', 'Vinaphone', 'MobiFone', 'Vietnamobile', 'Gmobile', 'iTel']) {
      expect(operators.has(name)).toBe(true);
    }
    expect(data.prefixes.some((entry) => entry.kind === 'MVNO')).toBe(true);
  });

  it('runs every shared test vector (the Dart tests of both phone apps run the same file): one rule, backend and mobile', () => {
    const vectors = JSON.parse(readFileSync(join(ROOT, 'config/vn-mobile-phone-cases.json'), 'utf8')) as { cases: Array<{ input: string; expected: string | null }> };
    expect(vectors.cases.length).toBeGreaterThan(30);
    for (const { input, expected } of vectors.cases) {
      expect([input, normalizeVietnamMobile(input) ?? null]).toEqual([input, expected]);
    }
  });
});
