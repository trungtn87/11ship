import { describe, expect, it } from '@jest/globals';
import { allLeaves, canOpenRoute, visibleMenu, activeMenuId, breadcrumb } from './menu';
import { formatRoute, parseRoute } from './routes';
import { intervalText, ShopCommandRequest, ShopCommandResult, StatusFlow, weekLines } from './shops';

const ID = '11111111-1111-4111-8111-111111111111';

function scripted(...answers: ShopCommandResult[]): { source: { command: (request: ShopCommandRequest) => Promise<ShopCommandResult> }; sent: ShopCommandRequest[] } {
  const sent: ShopCommandRequest[] = [];
  const queue = [...answers];
  return {
    sent,
    source: {
      command: (request) => {
        sent.push(request);
        return Promise.resolve(queue.shift() ?? { kind: 'unknown' });
      },
    },
  };
}
const keys = (...values: string[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 'exhausted';
};

describe('admin web shops - the disable / enable flow', () => {
  it('needs a reason of 1-500 characters and sends nothing without one', async () => {
    const { source, sent } = scripted({ kind: 'ok' });
    const flow = new StatusFlow(source, keys('k1'), ID, 'disable', 4);
    expect(await flow.submit()).toBeUndefined();
    expect(flow.view.reasonError).toBe('Lý do là bắt buộc.');
    flow.typed('   ');
    expect(await flow.submit()).toBeUndefined();
    flow.typed('x'.repeat(501));
    expect(await flow.submit()).toBeUndefined();
    expect(flow.view.reasonError).toBe('Lý do tối đa 500 ký tự.');
    expect(sent).toEqual([]);
    flow.typed(`  ${'y'.repeat(500)}  `);
    expect((await flow.submit())?.kind).toBe('ok');
    expect(sent).toEqual([{ id: ID, name: 'disable', version: 4, reason: 'y'.repeat(500), key: 'k1' }]);
    expect(flow.view.phase).toBe('done');
  });

  it('keeps the same payload and key after an unknown result, locks the dialog, and a retry sends exactly the same request', async () => {
    const { source, sent } = scripted({ kind: 'unknown' }, { kind: 'rate-limited', retryAfterSec: 5 }, { kind: 'ok' });
    const flow = new StatusFlow(source, keys('k1', 'k2'), ID, 'enable', 7);
    flow.typed('Đã khắc phục');
    await flow.submit();
    expect(flow.view.phase).toBe('unknown');
    expect(flow.locked).toBe(true);
    expect(flow.canDismiss).toBe(false);
    expect(flow.dismiss()).toBe(false);
    // Typing is ignored while the result is unknown: the payload cannot drift away from what may already be executed.
    flow.typed('Lý do khác');
    await flow.submit();
    expect(flow.view.phase).toBe('unknown');
    await flow.submit();
    expect(flow.view.phase).toBe('done');
    expect(sent.map((request) => [request.key, request.version, request.reason])).toEqual([['k1', 7, 'Đã khắc phục'], ['k1', 7, 'Đã khắc phục'], ['k1', 7, 'Đã khắc phục']]);
  });

  it('does not start a second write while one is sending', async () => {
    let release: (result: ShopCommandResult) => void = () => undefined;
    const sent: ShopCommandRequest[] = [];
    const flow = new StatusFlow(
      { command: (request) => { sent.push(request); return new Promise<ShopCommandResult>((resolve) => { release = resolve; }); } },
      keys('k1', 'k2'),
      ID,
      'disable',
      1,
    );
    flow.typed('Lý do');
    const first = flow.submit();
    expect(flow.view.phase).toBe('sending');
    expect(flow.locked).toBe(true);
    expect(await flow.submit()).toBeUndefined();
    expect(sent).toHaveLength(1);
    release({ kind: 'ok' });
    await first;
  });

  it('a conflict keeps the typed reason, refuses to confirm again until the new state was read, then uses the new version and a new key', async () => {
    const { source, sent } = scripted({ kind: 'conflict' }, { kind: 'ok' });
    const flow = new StatusFlow(source, keys('k1', 'k2'), ID, 'disable', 3);
    flow.typed('Vi phạm');
    await flow.submit();
    expect(flow.view.phase).toBe('conflict');
    expect(flow.reason).toBe('Vi phạm');
    expect(flow.canDismiss).toBe(true);
    // Confirming without reading the new state sends nothing.
    expect(await flow.submit()).toBeUndefined();
    expect(sent).toHaveLength(1);
    flow.refreshed(9);
    expect(flow.view.phase).toBe('editing');
    expect(flow.reason).toBe('Vi phạm');
    await flow.submit();
    expect(sent.map((request) => [request.key, request.version, request.reason])).toEqual([['k1', 3, 'Vi phạm'], ['k2', 9, 'Vi phạm']]);
  });

  it('a refusal changes nothing and lets the person edit the reason and confirm again with a new key', async () => {
    const { source, sent } = scripted({ kind: 'refused', code: 'SHOP_PROFILE_INCOMPLETE' }, { kind: 'ok' });
    const flow = new StatusFlow(source, keys('k1', 'k2'), ID, 'enable', 2);
    flow.typed('Mở lại');
    await flow.submit();
    expect(flow.view.phase).toBe('editing');
    expect(flow.view.message).toContain('thiếu tọa độ lấy hàng');
    expect(flow.locked).toBe(false);
    flow.typed('Mở lại sau khi bổ sung');
    await flow.submit();
    expect(sent.map((request) => [request.key, request.reason])).toEqual([['k1', 'Mở lại'], ['k2', 'Mở lại sau khi bổ sung']]);
  });

  it('a lost session or a missing right ends the flow without keeping anything to replay', async () => {
    for (const kind of ['session-expired', 'forbidden'] as const) {
      const { source } = scripted({ kind });
      const flow = new StatusFlow(source, keys('k1'), ID, 'disable', 1);
      flow.typed('Lý do');
      await flow.submit();
      expect(flow.view.phase).toBe('closed');
      expect(flow.key).toBeUndefined();
    }
  });

  it('Cancel is possible only while nothing is running', () => {
    const flow = new StatusFlow(scripted().source, keys('k1'), ID, 'disable', 1);
    expect(flow.dismiss()).toBe(true);
    expect(flow.view.phase).toBe('closed');
  });
});

describe('admin web shops - schedule text', () => {
  it('names the 24-hour and overnight shapes the schedule rules allow', () => {
    expect(intervalText({ weekday: 1, startMinute: 0, endMinute: 1440, endDayOffset: 0 })).toBe('Cả ngày (24 giờ)');
    expect(intervalText({ weekday: 1, startMinute: 480, endMinute: 1320, endDayOffset: 0 })).toBe('08:00 – 22:00');
    expect(intervalText({ weekday: 5, startMinute: 1320, endMinute: 120, endDayOffset: 1 })).toBe('22:00 – 02:00 (hôm sau)');
    expect(intervalText({ weekday: 5, startMinute: 360, endMinute: 360, endDayOffset: 1 })).toBe('06:00 – 06:00 (hôm sau · 24 giờ)');
    expect(intervalText({ weekday: 2, startMinute: 61, endMinute: 1440, endDayOffset: 0 })).toBe('01:01 – 24:00');
  });

  it('lays the week out Monday first, several intervals per day in time order, a day without one is a day off', () => {
    const lines = weekLines([
      { weekday: 3, startMinute: 1020, endMinute: 1320, endDayOffset: 0 },
      { weekday: 3, startMinute: 420, endMinute: 660, endDayOffset: 0 },
    ]);
    expect(lines.map((line) => line.label)).toEqual(['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật']);
    expect(lines[2]?.intervals).toEqual(['07:00 – 11:00', '17:00 – 22:00']);
    expect(lines[0]?.intervals).toEqual([]);
  });
});

describe('admin web shops - routes and menu', () => {
  it('parses and formats the list and the detail (a reload or a bookmark opens the same page)', () => {
    expect(parseRoute('/operations/shops')).toEqual({ name: 'shops' });
    expect(parseRoute('/operations/shops/')).toEqual({ name: 'shops' });
    expect(parseRoute('/operations/shops', '?profile=DISABLED&schedule=OPEN&q=ph%E1%BB%9F')).toEqual({ name: 'shops', q: 'phở', profile: 'DISABLED', schedule: 'OPEN' });
    expect(parseRoute('/operations/shops', `?area=${ID}&profile=BOGUS&schedule=ALL`)).toEqual({ name: 'shops', area: ID });
    expect(parseRoute(`/operations/shops/${ID}`)).toEqual({ name: 'shop', id: ID });
    expect(parseRoute(`/operations/shops/${ID}`, '?tab=menu')).toEqual({ name: 'shop', id: ID, tab: 'menu' });
    expect(parseRoute(`/operations/shops/${ID}`, '?tab=nope')).toEqual({ name: 'shop', id: ID });
    expect(parseRoute('/operations/shops/not-an-id')).toEqual({ name: 'home' });
    for (const route of [{ name: 'shops' } as const, { name: 'shops', q: 'Phở', profile: 'ACTIVE', schedule: 'CLOSED', area: ID } as const, { name: 'shop', id: ID } as const, { name: 'shop', id: ID, tab: 'history' } as const]) {
      const [path, search] = formatRoute(route).split('?');
      expect(parseRoute(path as string, search === undefined ? '' : `?${search}`)).toEqual(route);
    }
  });

  it('the Quán entry is real, needs the shops grant (VIEW on SHOP), and keeps itself lit on the detail', () => {
    const leaf = allLeaves().find((entry) => entry.id === 'shops');
    expect(leaf).toMatchObject({ ready: true, route: { name: 'shops' }, access: 'shops' });
    expect(canOpenRoute('ADMIN', new Set(['users', 'shops'] as const), { name: 'shops' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set(['users', 'drivers'] as const), { name: 'shop', id: ID })).toBe(false);
    expect(canOpenRoute('SYSTEM', new Set(), { name: 'shop', id: ID })).toBe(true);
    expect(activeMenuId({ name: 'shop', id: ID })).toBe('shops');
    expect(breadcrumb({ name: 'shop', id: ID })).toEqual(['Vận hành', 'Quán', 'Chi tiết']);
    expect(visibleMenu('ADMIN', new Set(['users', 'shops'] as const)).flatMap((group) => group.items).map((item) => item.id)).toContain('shops');
    expect(visibleMenu('ADMIN', new Set(['users'] as const)).flatMap((group) => group.items).map((item) => item.id)).not.toContain('shops');
  });
});
