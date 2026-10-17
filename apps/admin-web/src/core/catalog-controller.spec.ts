import { describe, expect, it } from '@jest/globals';
import { CatalogCommand, CatalogQuery, CatalogRead, CatalogSaveResult, CatalogScreen, CatalogSource, CategoryRow } from './catalog';
import { CatalogController } from './catalog-controller';

const row = (n: number, over: Partial<CategoryRow> = {}): CategoryRow => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  name: `Nhóm ${String(n)}`,
  sortOrder: n,
  status: 'ACTIVE',
  itemCount: n,
  version: 1,
  updatedAt: '2026-10-16T03:00:00.000Z',
  ...over,
});

/** A scripted source: reads and saves can be held open to prove ordering, and every request is recorded. */
class FakeSource implements CatalogSource {
  readonly lists: CatalogQuery[] = [];
  readonly saves: CatalogCommand[] = [];
  readonly #readHolds: Array<(read: CatalogRead) => void> = [];
  readonly #saveHolds: Array<(result: CatalogSaveResult) => void> = [];
  holdReads = false;
  holdSaves = false;
  rows: CategoryRow[] = [row(1), row(2), row(3)];
  total = 3;
  saveAnswers: CatalogSaveResult[] = [];

  list(query: CatalogQuery): Promise<CatalogRead> {
    this.lists.push(query);
    const read: CatalogRead = { kind: 'ready', rows: this.rows, total: this.total, nextSortOrder: 4 };
    if (this.holdReads) {
      return new Promise((resolve) => this.#readHolds.push(resolve));
    }
    return Promise.resolve(read);
  }

  save(command: CatalogCommand): Promise<CatalogSaveResult> {
    this.saves.push(command);
    if (this.holdSaves) {
      return new Promise((resolve) => this.#saveHolds.push(resolve));
    }
    return Promise.resolve(this.saveAnswers.shift() ?? { kind: 'ok' });
  }

  answerRead(read: CatalogRead, index = 0): void {
    this.#readHolds.splice(index, 1)[0]?.(read);
  }

  answerSave(result: CatalogSaveResult): void {
    this.#saveHolds.shift()?.(result);
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(source = new FakeSource()) {
  let keys = 0;
  const events = { lost: 0, forbidden: 0 };
  const controller = new CatalogController({ source, newKey: () => `key-${String((keys += 1))}`, onSessionLost: () => (events.lost += 1), onForbidden: () => (events.forbidden += 1) });
  const seen: CatalogScreen[] = [];
  controller.subscribe((screen) => seen.push(screen));
  return { source, controller, events, seen };
}

async function ready() {
  const s = setup();
  s.controller.load();
  await tick();
  return s;
}

describe('catalog controller - the list', () => {
  it('loads page 1, shows the rows, and a filter change goes back to page 1', async () => {
    const { controller, source } = await ready();
    expect(controller.screen.list).toMatchObject({ kind: 'ready', total: 3, pages: 1 });
    controller.filter({ query: 'ốc' });
    expect(controller.screen.filter).toEqual({ query: 'ốc', status: 'ALL', page: 1 });
    controller.load();
    await tick();
    expect(source.lists.at(-1)).toEqual({ query: 'ốc', status: 'ALL', page: 1 });
  });

  it('pages: 25 groups are 3 pages; the page buttons stay inside them', async () => {
    const s = setup();
    s.source.total = 25;
    s.controller.load();
    await tick();
    expect(s.controller.screen.list).toMatchObject({ kind: 'ready', pages: 3 });
    s.controller.page(3);
    await tick();
    expect(s.source.lists.at(-1)?.page).toBe(3);
    s.controller.page(4);
    s.controller.page(0);
    await tick();
    expect(s.source.lists).toHaveLength(2);
  });

  it('an empty page of a shrunk list shows the new last page', async () => {
    const s = setup();
    s.source.total = 25;
    s.controller.load();
    await tick();
    s.controller.page(3);
    await tick();
    s.source.total = 20;
    s.source.rows = [];
    s.controller.load();
    await tick();
    expect(s.source.lists.at(-1)?.page).toBe(2);
  });

  it('distinguishes "no group yet" from "nothing matches the search"', async () => {
    const s = setup();
    s.source.rows = [];
    s.source.total = 0;
    s.controller.load();
    await tick();
    expect(s.controller.screen.list).toEqual({ kind: 'empty', filtered: false });
    s.controller.filter({ status: 'INACTIVE' });
    s.controller.load();
    await tick();
    expect(s.controller.screen.list).toEqual({ kind: 'empty', filtered: true });
  });

  it('a late answer of a replaced request is dropped (the older search never overwrites the newer)', async () => {
    const s = setup();
    s.source.holdReads = true;
    s.controller.filter({ query: 'a' });
    s.controller.load();
    s.controller.filter({ query: 'ab' });
    s.controller.load();
    s.source.answerRead({ kind: 'ready', rows: [row(9)], total: 1, nextSortOrder: 0 }, 1);
    await tick();
    s.source.answerRead({ kind: 'ready', rows: [row(1)], total: 1, nextSortOrder: 0 }, 0);
    await tick();
    expect(s.controller.screen.list).toMatchObject({ kind: 'ready', rows: [expect.objectContaining({ name: 'Nhóm 9' })] });
  });

  it('a failed read is shown with a retry; 401 ends the session; 403 asks for the rights to be read again; not-wired says so', async () => {
    const s = setup();
    const answers: CatalogRead[] = [{ kind: 'failed', failure: 'offline' }, { kind: 'failed', failure: 'session-expired' }, { kind: 'failed', failure: 'forbidden' }, { kind: 'not-wired', reason: 'x' }];
    s.source.list = () => Promise.resolve(answers.shift() as CatalogRead);
    s.controller.load();
    await tick();
    expect(s.controller.screen.list).toEqual({ kind: 'failed', failure: 'offline' });
    s.controller.load();
    await tick();
    expect(s.events.lost).toBe(1);
    s.controller.load();
    await tick();
    expect(s.events.forbidden).toBe(1);
    expect(s.controller.screen.list).toMatchObject({ kind: 'failed', failure: 'forbidden' });
    s.controller.load();
    await tick();
    expect(s.controller.screen.list).toEqual({ kind: 'not-wired', reason: 'x' });
    s.controller.beginCreate();
    expect(s.controller.screen.dialog).toBeUndefined();
  });
});

describe('catalog controller - create and edit', () => {
  it('the new group defaults to the last position and Đang dùng; saving sends ONE request with a key, closes, says so and reads the list again', async () => {
    const { controller, source } = await ready();
    controller.beginCreate();
    expect(controller.screen.dialog).toMatchObject({ kind: 'form', mode: 'create', draft: { name: '', sortOrder: '4', status: 'ACTIVE' } });
    controller.edit({ name: '  Món   chay ', sortOrder: '4', status: 'ACTIVE' });
    controller.submit();
    await tick();
    expect(source.saves).toEqual([{ kind: 'create', name: 'Món chay', sortOrder: 4, status: 'ACTIVE', key: 'key-1' }]);
    expect(controller.screen.dialog).toBeUndefined();
    expect(controller.screen.notice).toBe('Đã thêm nhóm «Món chay».');
    expect(source.lists).toHaveLength(2);
  });

  it('validation reports and sends nothing; typing clears the report; the draft is never rewritten', async () => {
    const { controller, source } = await ready();
    controller.beginCreate();
    controller.edit({ name: '   ', sortOrder: '-2', status: 'INACTIVE' });
    controller.submit();
    expect(source.saves).toHaveLength(0);
    expect(controller.screen.dialog).toMatchObject({ phase: 'form', errors: { name: 'Nhập tên nhóm.', sortOrder: expect.any(String) }, draft: { name: '   ', sortOrder: '-2', status: 'INACTIVE' } });
    controller.edit({ name: 'Ốc', sortOrder: '-2', status: 'INACTIVE' });
    expect(controller.screen.dialog).toMatchObject({ errors: {} });
  });

  it('edit sends the version of the row the admin looked at, with all three fields', async () => {
    const { controller, source } = await ready();
    controller.beginEdit(row(2).id);
    expect(controller.screen.dialog).toMatchObject({ kind: 'form', mode: 'edit', draft: { name: 'Nhóm 2', sortOrder: '2', status: 'ACTIVE' } });
    controller.edit({ name: 'Hải sản', sortOrder: '9', status: 'INACTIVE' });
    controller.submit();
    await tick();
    expect(source.saves[0]).toEqual({ kind: 'update', id: row(2).id, version: 1, name: 'Hải sản', sortOrder: 9, status: 'INACTIVE', key: 'key-1' });
    expect(controller.screen.notice).toBe('Đã lưu nhóm «Hải sản».');
  });

  it('while saving the form is locked and a second click or any other write is ignored; only one request goes out', async () => {
    const { controller, source } = await ready();
    source.holdSaves = true;
    controller.beginCreate();
    controller.edit({ name: 'A', sortOrder: '4', status: 'ACTIVE' });
    controller.submit();
    controller.submit();
    controller.submit();
    expect(source.saves).toHaveLength(1);
    expect(controller.screen.dialog).toMatchObject({ phase: 'working' });
    controller.edit({ name: 'B', sortOrder: '4', status: 'ACTIVE' });
    controller.cancel();
    controller.beginToggle(row(1).id);
    expect(controller.screen.dialog).toMatchObject({ phase: 'working', draft: { name: 'A' } });
    source.answerSave({ kind: 'ok' });
    await tick();
    expect(controller.screen.dialog).toBeUndefined();
    expect(source.saves).toHaveLength(1);
  });

  it('a duplicate name keeps everything typed and says so; an inactive twin offers the old group', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'name-taken', inactive: false }, { kind: 'name-taken', inactive: true }];
    controller.beginCreate();
    controller.edit({ name: 'Ốc', sortOrder: '7', status: 'ACTIVE' });
    controller.submit();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ phase: 'form', draft: { name: 'Ốc', sortOrder: '7' }, errors: { name: expect.stringContaining('trùng tên') } });
    controller.submit();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ inactiveTwin: true, errors: { name: expect.stringContaining('ngừng dùng') } });
    controller.showTwin();
    expect(controller.screen.dialog).toBeUndefined();
    expect(controller.screen.filter).toEqual({ query: 'Ốc', status: 'INACTIVE', page: 1 });
    await tick();
    expect(source.lists.at(-1)).toEqual({ query: 'Ốc', status: 'INACTIVE', page: 1 });
  });

  it('a version conflict keeps the draft and needs a reload before anything else; the reload drops the stale form', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'conflict' }];
    controller.beginEdit(row(1).id);
    controller.edit({ name: 'Mới', sortOrder: '1', status: 'ACTIVE' });
    controller.submit();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ phase: 'conflict', draft: { name: 'Mới' } });
    controller.submit();
    expect(source.saves).toHaveLength(1);
    controller.reload();
    expect(controller.screen.dialog).toBeUndefined();
    await tick();
    expect(source.lists).toHaveLength(2);
  });

  it('refusals keep the form with the server wording; 401 ends the session; 403 re-reads the rights', async () => {
    const { controller, source, events } = await ready();
    source.saveAnswers = [{ kind: 'rejected' }, { kind: 'rate-limited' }, { kind: 'forbidden' }, { kind: 'not-wired' }, { kind: 'session-expired' }];
    controller.beginCreate();
    controller.edit({ name: 'A', sortOrder: '4', status: 'ACTIVE' });
    for (const expected of ['Yêu cầu không hợp lệ', 'quá nhanh', 'không còn quyền', 'chưa được nối']) {
      controller.submit();
      await tick();
      expect(controller.screen.dialog).toMatchObject({ phase: 'failed', draft: { name: 'A' }, message: expect.stringContaining(expected) });
    }
    expect(events.forbidden).toBe(1);
    controller.submit();
    await tick();
    expect(events.lost).toBe(1);
  });

  it('the group is gone: the form says so and the list is read again', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'not-found' }];
    controller.beginEdit(row(1).id);
    controller.submit();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ phase: 'failed', message: expect.stringContaining('không còn tồn tại') });
    expect(source.lists).toHaveLength(2);
  });
});

describe('catalog controller - a lost answer is not a failure', () => {
  it('keeps the SAME key and body for "Thử lại"; nothing else can be written meanwhile; the retry does not make a new key', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'unknown' }, { kind: 'unknown' }, { kind: 'ok' }];
    controller.beginCreate();
    controller.edit({ name: 'Món chay', sortOrder: '4', status: 'ACTIVE' });
    controller.submit();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ phase: 'unknown', message: expect.stringContaining('Chưa xác nhận') });
    // Offline again on the retry: still unknown, still the same request.
    controller.retry();
    await tick();
    expect(controller.screen.dialog).toMatchObject({ phase: 'unknown' });
    controller.submit();
    controller.beginToggle(row(1).id);
    controller.retry();
    await tick();
    expect(source.saves).toHaveLength(3);
    expect(new Set(source.saves.map((command) => command.key))).toEqual(new Set(['key-1']));
    expect(new Set(source.saves.map((command) => JSON.stringify(command)))).toHaveProperty('size', 1);
    expect(controller.screen.dialog).toBeUndefined();
    expect(controller.screen.notice).toBe('Đã thêm nhóm «Món chay».');
  });

  it('"Kiểm tra lại" reads the list and drops the unanswered request; a new save then gets a NEW key', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'unknown' }, { kind: 'ok' }];
    controller.beginCreate();
    controller.edit({ name: 'A', sortOrder: '4', status: 'ACTIVE' });
    controller.submit();
    await tick();
    controller.recheck();
    await tick();
    expect(source.lists).toHaveLength(2);
    expect(controller.screen.dialog).toMatchObject({ phase: 'form', draft: { name: 'A' } });
    controller.retry();
    expect(source.saves).toHaveLength(1);
    controller.submit();
    await tick();
    expect(source.saves.map((command) => command.key)).toEqual(['key-1', 'key-2']);
  });

  it('Hủy on an unanswered request drops it and reads the list so the admin sees what the server holds', async () => {
    const { controller, source } = await ready();
    source.saveAnswers = [{ kind: 'unknown' }];
    controller.beginToggle(row(1).id);
    controller.submit();
    await tick();
    controller.cancel();
    await tick();
    expect(controller.screen.dialog).toBeUndefined();
    expect(source.lists).toHaveLength(2);
    controller.retry();
    expect(source.saves).toHaveLength(1);
  });

  it('a late answer after the page was left changes nothing', async () => {
    const { controller, source, seen } = await ready();
    source.holdSaves = true;
    controller.beginCreate();
    controller.edit({ name: 'A', sortOrder: '4', status: 'ACTIVE' });
    controller.submit();
    controller.dispose();
    const count = seen.length;
    source.answerSave({ kind: 'ok' });
    await tick();
    expect(seen.length).toBe(count);
    expect(source.lists).toHaveLength(1);
  });
});

describe('catalog controller - switching a group off and on', () => {
  it('Ngừng dùng asks first; confirming sends the row as it is with only the status changed; the dishes are not part of the request', async () => {
    const { controller, source } = await ready();
    controller.beginToggle(row(2).id);
    expect(controller.screen.dialog).toEqual({ kind: 'toggle', id: row(2).id, name: 'Nhóm 2', to: 'INACTIVE', itemCount: 2, phase: 'form' });
    expect(source.saves).toHaveLength(0);
    controller.cancel();
    expect(source.saves).toHaveLength(0);
    controller.beginToggle(row(2).id);
    controller.submit();
    await tick();
    expect(source.saves).toEqual([{ kind: 'update', id: row(2).id, version: 1, name: 'Nhóm 2', sortOrder: 2, status: 'INACTIVE', key: 'key-1' }]);
    expect(controller.screen.notice).toBe('Đã ngừng dùng nhóm «Nhóm 2».');
  });

  it('an inactive group is offered "Kích hoạt" and goes back to ACTIVE', async () => {
    const s = setup();
    s.source.rows = [row(1, { status: 'INACTIVE' })];
    s.source.total = 1;
    s.controller.load();
    await tick();
    s.controller.beginToggle(row(1).id);
    expect(s.controller.screen.dialog).toMatchObject({ kind: 'toggle', to: 'ACTIVE' });
    s.controller.submit();
    await tick();
    expect(s.source.saves[0]).toMatchObject({ status: 'ACTIVE' });
    expect(s.controller.screen.notice).toBe('Đã kích hoạt lại nhóm «Nhóm 1».');
  });

  it('there is no delete: the controller offers no such operation', () => {
    const names = Object.getOwnPropertyNames(CatalogController.prototype);
    expect(names.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
