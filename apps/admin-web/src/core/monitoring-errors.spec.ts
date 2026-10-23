import { describe, expect, it } from '@jest/globals';
import { NO_GRANTS, canOpenRoute, visibleMenu } from './menu';
import { formatRoute, parseRoute } from './routes';

describe('M13 SYSTEM-only monitor menu', () => {
  it('allows SYSTEM and denies ADMIN, even when monitoring grant is present', () => {
    const route = parseRoute('/system/monitoring/errors');
    expect(route).toEqual({ name: 'monitoring-errors' });
    expect(formatRoute(route)).toBe('/system/monitoring/errors');
    expect(canOpenRoute('SYSTEM', NO_GRANTS, route)).toBe(true);
    expect(canOpenRoute('ADMIN', new Set(['monitoring']), route)).toBe(false);
    expect(JSON.stringify(visibleMenu('SYSTEM'))).toContain('monitoring-errors');
    expect(JSON.stringify(visibleMenu('ADMIN', new Set(['monitoring'])))).not.toContain('monitoring-errors');
  });
});
