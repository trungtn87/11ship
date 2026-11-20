import { describe, expect, it } from '@jest/globals';
import { CatalogCommand, CatalogRead, CatalogSaveResult, CatalogSource, CategoryRow } from './catalog';
import { CatalogController } from './catalog-controller';
import { bytesToBase64, checkCategoryIcon, ICON_MAX_BYTES, ICON_MESSAGE } from './category-icon';

// Issue #412: the picture of a dish group in the administration web. The client check mirrors the server; these tests pin the rules and the
// icon popup flow of the controller (one request per save, the same key on an unknown outcome, nothing sent for a refused file).

function png(width: number, height: number, extra = 0): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  return bytes;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ID = '11111111-1111-4111-8111-111111111111';

const row = (over: Partial<CategoryRow> = {}): CategoryRow => ({
  id: ID,
  name: 'Ốc',
  sortOrder: 1,
  status: 'ACTIVE',
  itemCount: 2,
  version: 4,
  updatedAt: '2026-10-16T03:00:00.000Z',
  imageUrl: null,
  ...over,
});

describe('dish group icon - client check', () => {
  it('accepts a square PNG or WebP of at least 256 x 256 and reports its type from the bytes', () => {
    expect(checkCategoryIcon(png(256, 256))).toEqual({ ok: true, contentType: 'image/png' });
    expect(checkCategoryIcon(webpVp8x(300, 300))).toEqual({ ok: true, contentType: 'image/webp' });
  });

  it('refuses JPEG, text and an empty file with the Vietnamese sentence of that rule', () => {
    expect(checkCategoryIcon(JPEG)).toEqual({ ok: false, message: ICON_MESSAGE.format });
    expect(checkCategoryIcon(new TextEncoder().encode('<svg></svg>'))).toEqual({ ok: false, message: ICON_MESSAGE.format });
    expect(checkCategoryIcon(new Uint8Array(0))).toEqual({ ok: false, message: ICON_MESSAGE.empty });
  });

  it('refuses more than 1 MB before looking at the content', () => {
    expect(checkCategoryIcon(png(256, 256, ICON_MAX_BYTES))).toEqual({ ok: false, message: ICON_MESSAGE.tooLarge });
    expect(checkCategoryIcon(png(256, 256, ICON_MAX_BYTES - 33))).toEqual({ ok: true, contentType: 'image/png' });
  });

  it('refuses a picture below 256 px on a side and a picture that is not square', () => {
    expect(checkCategoryIcon(png(255, 255))).toEqual({ ok: false, message: ICON_MESSAGE.tooSmall });
    expect(checkCategoryIcon(png(512, 300))).toEqual({ ok: false, message: ICON_MESSAGE.notSquare });
    expect(checkCategoryIcon(webpVp8x(256, 300))).toEqual({ ok: false, message: ICON_MESSAGE.notSquare });
  });

  it('encodes bytes as standard base64 for the request body', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    const big = new Uint8Array(200_000).fill(255);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
});

/** Scripted source for the popup flow: list answers ready with the given rows; saves answer from a queue. */
class IconSource implements CatalogSource {
  readonly saves: CatalogCommand[] = [];
  answers: CatalogSaveResult[] = [];
  rows: CategoryRow[] = [row()];

  list(): Promise<CatalogRead> {
    return Promise.resolve({ kind: 'ready', rows: this.rows, total: this.rows.length, nextSortOrder: 2 });
  }

  save(command: CatalogCommand): Promise<CatalogSaveResult> {
    this.saves.push(command);
    return Promise.resolve(this.answers.shift() ?? { kind: 'ok' });
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function openIcon(source: IconSource, keys: string[] = ['key-1', 'key-2', 'key-3']) {
  const controller = new CatalogController({ source, newKey: () => keys.shift() ?? 'key-x', onSessionLost: () => undefined, onForbidden: () => undefined });
  controller.load();
  await settle();
  controller.beginIcon(ID);
  return controller;
}

describe('dish group icon - popup flow', () => {
  it('sends nothing for a refused file, keeps nothing, and says why', async () => {
    const source = new IconSource();
    const controller = await openIcon(source);
    controller.pickIcon(JPEG);
    const dialog = controller.screen.dialog;
    expect(dialog).toMatchObject({ kind: 'icon', phase: 'form', message: ICON_MESSAGE.format });
    expect(dialog?.kind === 'icon' ? dialog.picked : 'x').toBeUndefined();
    controller.saveIcon();
    await settle();
    expect(source.saves).toEqual([]);
  });

  it('saves a valid file with ONE request: the group version, the base64 bytes and a new key; success closes the popup and reloads', async () => {
    const source = new IconSource();
    const controller = await openIcon(source);
    controller.pickIcon(png(256, 256));
    controller.saveIcon();
    controller.saveIcon();
    await settle();
    expect(source.saves).toEqual([{ kind: 'icon-set', id: ID, version: 4, dataBase64: bytesToBase64(png(256, 256)), key: 'key-1' }]);
    expect(controller.screen.dialog).toBeUndefined();
    expect(controller.screen.notice).toBe('Đã cập nhật ảnh nhóm «Ốc».');
  });

  it('a refused save keeps the picked file for a correction and shows the server sentence', async () => {
    const source = new IconSource();
    source.answers = [{ kind: 'icon-rejected', message: ICON_MESSAGE.tooSmall }];
    const controller = await openIcon(source);
    controller.pickIcon(png(256, 256));
    controller.saveIcon();
    await settle();
    const dialog = controller.screen.dialog;
    expect(dialog).toMatchObject({ kind: 'icon', phase: 'failed', message: ICON_MESSAGE.tooSmall });
    expect(dialog?.kind === 'icon' ? dialog.picked?.contentType : undefined).toBe('image/png');
  });

  it('an unknown outcome keeps the same key and body for "Thử lại", and nothing else is sent meanwhile', async () => {
    const source = new IconSource();
    source.answers = [{ kind: 'unknown' }, { kind: 'ok' }];
    const controller = await openIcon(source);
    controller.pickIcon(png(256, 256));
    controller.saveIcon();
    await settle();
    expect(controller.screen.dialog).toMatchObject({ kind: 'icon', phase: 'unknown' });
    controller.retry();
    await settle();
    expect(source.saves.length).toBe(2);
    expect(source.saves[1]).toEqual(source.saves[0]);
    expect(source.saves[0]).toMatchObject({ key: 'key-1' });
    expect(controller.screen.dialog).toBeUndefined();
  });

  it('removing sends one remove request with the version; a group without an icon has nothing to remove', async () => {
    const source = new IconSource();
    source.rows = [row({ imageUrl: '/v1/admin/menu-categories/' + ID + '/image?v=4' })];
    const controller = await openIcon(source);
    controller.clearIcon();
    await settle();
    expect(source.saves).toEqual([{ kind: 'icon-remove', id: ID, version: 4, key: 'key-1' }]);
    expect(controller.screen.notice).toBe('Đã xóa ảnh nhóm «Ốc». Nhóm sẽ dùng icon mặc định.');

    const none = new IconSource();
    const plain = await openIcon(none);
    plain.clearIcon();
    await settle();
    expect(none.saves).toEqual([]);
  });

  it('the form submit never sends an icon popup; a conflict asks to reload and sends nothing by itself', async () => {
    const source = new IconSource();
    source.answers = [{ kind: 'conflict' }];
    const controller = await openIcon(source);
    controller.pickIcon(png(256, 256));
    controller.submit();
    expect(source.saves).toEqual([]);
    controller.saveIcon();
    await settle();
    expect(controller.screen.dialog).toMatchObject({ kind: 'icon', phase: 'conflict' });
    expect(source.saves.length).toBe(1);
  });
});
