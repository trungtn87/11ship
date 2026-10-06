import { describe, expect, it } from '@jest/globals';
import { JsonLogger } from './json-logger';

function capture(): { logger: JsonLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: new JsonLogger((line) => {
      lines.push(line);
    }),
  };
}

function parse(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

describe('JsonLogger', () => {
  it('writes exactly one JSON line with time, level and event', () => {
    const { logger, lines } = capture();
    logger.log('info', 'server_listening', { port: 3000 });

    expect(lines).toHaveLength(1);
    const entry = parse(lines[0]);
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('server_listening');
    expect(entry.port).toBe(3000);
    expect(Number.isNaN(Date.parse(String(entry.time)))).toBe(false);
  });

  it('drops every key that is not whitelisted', () => {
    const { logger, lines } = capture();
    logger.log('error', 'request_failed', {
      request_id: 'abc',
      status: 500,
      password: 'SECRET_MARKER_LOGGER',
      database_url: 'postgres://u:SECRET_MARKER_LOGGER@h/db',
      sql: 'SELECT * FROM users',
      body: { token: 'SECRET_MARKER_LOGGER' },
    });

    const entry = parse(lines[0]);
    expect(entry.request_id).toBe('abc');
    expect(entry.status).toBe(500);
    expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'request_id', 'status', 'time']);
    expect(lines.join('\n')).not.toContain('SECRET_MARKER_LOGGER');
  });

  it('ignores whitelisted keys that carry non-primitive or non-finite values', () => {
    const { logger, lines } = capture();
    logger.log('warn', 'odd_values', {
      status: Number.NaN,
      duration_ms: Number.POSITIVE_INFINITY,
      code: { nested: 'SECRET_MARKER_LOGGER' },
      method: ['GET'],
    });

    const entry = parse(lines[0]);
    expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'time']);
  });

  it('replaces control characters and truncates long strings', () => {
    const { logger, lines } = capture();
    logger.log('info', 'sanitize', { code: `line1\nline2\u0000${'x'.repeat(500)}` });

    const entry = parse(lines[0]);
    const code = String(entry.code);
    expect(code).not.toMatch(/[\n\r\u0000]/);
    expect(code.length).toBeLessThanOrEqual(128);
    expect(lines[0]?.includes('\n')).toBe(false);
  });
});
