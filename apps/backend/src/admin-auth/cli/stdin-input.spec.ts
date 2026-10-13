import { Readable } from 'node:stream';
import { describe, expect, it } from '@jest/globals';
import { CliInputError, readBootstrapInput, readSystemRecoveryApplyInput, readSystemRecoveryCheckInput } from './stdin-input';

const from = (text: string | Buffer[]): Readable => Readable.from(typeof text === 'string' ? [text] : text);
const GOOD = { phone: '0912345678', password: 'Correct-Horse-Battery-9' };

describe('readBootstrapInput', () => {
  it('reads one JSON object with exactly phone and password, and normalizes the phone', async () => {
    const result = await readBootstrapInput(from(JSON.stringify(GOOD)));
    expect(result.password).toBe(GOOD.password);
    expect(result.phoneNormalized).toMatch(/^\+\d+$/);
  });

  it('refuses everything else with one fixed error that echoes nothing', async () => {
    const bad = [
      '',
      'not json',
      '[]',
      'null',
      '"str"',
      JSON.stringify({ phone: GOOD.phone }),
      JSON.stringify({ ...GOOD, role: 'SYSTEM' }),
      JSON.stringify({ phone: 12345, password: GOOD.password }),
      JSON.stringify({ phone: GOOD.phone, password: 'short' }),
      JSON.stringify({ phone: 'abc', password: GOOD.password }),
    ];
    for (const text of bad) {
      const error = await readBootstrapInput(from(text)).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CliInputError);
      expect((error as Error).message).toBe('INVALID_INPUT');
      expect((error as Error).message).not.toContain(GOOD.password);
    }
  });

  it('refuses input above 4 KiB', async () => {
    const big = JSON.stringify({ ...GOOD, padding: 'x'.repeat(5000) });
    await expect(readBootstrapInput(from(big))).rejects.toBeInstanceOf(CliInputError);
    await expect(readBootstrapInput(from([Buffer.alloc(3000), Buffer.alloc(3000)]))).rejects.toBeInstanceOf(CliInputError);
  });
});

describe('system recovery input (M01-RESET)', () => {
  const APPLY = { phone: GOOD.phone, password: GOOD.password, expected_version: 3, confirmation: 'RESET_SYSTEM_LOCAL_TEST' };
  const fail = (read: () => Promise<unknown>) =>
    read().then(
      () => undefined,
      (caught: unknown) => caught,
    );

  it('reads exact check and apply objects', async () => {
    expect((await readSystemRecoveryCheckInput(from(JSON.stringify({ phone: GOOD.phone })))).phoneNormalized).toMatch(/^\+\d+$/);
    expect(await readSystemRecoveryApplyInput(from(JSON.stringify(APPLY)))).toMatchObject({ password: GOOD.password, expectedVersion: 3 });
  });

  it('refuses extra/missing fields, a bad confirmation and a bad version', async () => {
    const bad: unknown[] = [
      { ...APPLY, role: 'SYSTEM' },
      { ...APPLY, confirmation: 'yes' },
      { ...APPLY, confirmation: undefined },
      { ...APPLY, expected_version: 0 },
      { ...APPLY, expected_version: -1 },
      { ...APPLY, expected_version: 1.5 },
      { ...APPLY, expected_version: '3' },
      { ...APPLY, expected_version: Number.MAX_SAFE_INTEGER + 2 },
      { ...APPLY, password: 'short' },
    ];
    for (const value of bad) {
      expect(await fail(() => readSystemRecoveryApplyInput(from(JSON.stringify(value))))).toBeInstanceOf(CliInputError);
    }
    expect(await fail(() => readSystemRecoveryCheckInput(from(JSON.stringify({ phone: GOOD.phone, password: GOOD.password }))))).toBeInstanceOf(CliInputError);
    expect(await fail(() => readSystemRecoveryCheckInput(from('{}')))).toBeInstanceOf(CliInputError);
  });
});
