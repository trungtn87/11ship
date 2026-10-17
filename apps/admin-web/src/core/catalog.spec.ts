import { describe, expect, it } from '@jest/globals';
import { activateText, CategoryDraft, deactivateText, normalizeCategoryName, validateCategoryDraft } from './catalog';

const draft = (over: Partial<CategoryDraft> = {}): CategoryDraft => ({ name: 'Hải sản', sortOrder: '3', status: 'ACTIVE', ...over });

describe('dish group name and order (admin web)', () => {
  it('normalises white space and composition, never case or Vietnamese marks', () => {
    expect(normalizeCategoryName('  Hải   sản \t')).toBe('Hải sản');
    expect(normalizeCategoryName('Hải sản'.normalize('NFD'))).toBe('Hải sản');
    expect(normalizeCategoryName('ỐC hương')).toBe('ỐC hương');
    expect(normalizeCategoryName('Oc')).not.toBe(normalizeCategoryName('Ốc'));
  });

  it('accepts a valid draft and returns the stored form of the name', () => {
    const checked = validateCategoryDraft(draft({ name: '  Món   nướng ' }), false);
    expect(checked).toEqual({ ok: true, value: { name: 'Món nướng', sortOrder: 3, status: 'ACTIVE' } });
  });

  it('reports errors only: an empty or overlong name, a bad order; the draft itself is never rewritten', () => {
    const input = draft({ name: '   ', sortOrder: '-1' });
    const before = { ...input };
    expect(validateCategoryDraft(input, false)).toEqual({ ok: false, errors: { name: 'Nhập tên nhóm.', sortOrder: 'Thứ tự là số nguyên từ 0 đến 100000.' } });
    expect(input).toEqual(before);
    expect(validateCategoryDraft(draft({ name: 'x'.repeat(81) }), false)).toMatchObject({ ok: false, errors: { name: 'Tên nhóm tối đa 80 ký tự.' } });
    expect(validateCategoryDraft(draft({ name: 'x'.repeat(80) }), false).ok).toBe(true);
    // 80 characters counted as characters, not UTF-16 units.
    expect(validateCategoryDraft(draft({ name: 'ố'.repeat(80) }), false).ok).toBe(true);
    for (const bad of ['1.5', 'abc', '1e3', '-0', '100001', '1234567', '٣']) {
      expect(validateCategoryDraft(draft({ sortOrder: bad }), false).ok).toBe(false);
    }
    expect(validateCategoryDraft(draft({ sortOrder: '0' }), false).ok).toBe(true);
    expect(validateCategoryDraft(draft({ sortOrder: '100000' }), false).ok).toBe(true);
    expect(validateCategoryDraft(draft({ name: 'Tên\u0007x' }), false)).toMatchObject({ ok: false });
  });

  it('an empty order means "after the last group" on create and is an error on edit', () => {
    expect(validateCategoryDraft(draft({ sortOrder: '  ' }), true)).toEqual({ ok: true, value: { name: 'Hải sản', sortOrder: null, status: 'ACTIVE' } });
    expect(validateCategoryDraft(draft({ sortOrder: '' }), false)).toMatchObject({ ok: false, errors: { sortOrder: 'Nhập thứ tự (số nguyên không âm).' } });
  });

  it('the confirmation texts are exactly the specified wording', () => {
    expect(deactivateText('Đồ uống')).toBe('Ngừng dùng nhóm «Đồ uống»? Chủ quán sẽ không chọn được nhóm này cho món mới. Các món đang thuộc nhóm vẫn được giữ nguyên.');
    expect(activateText('Đồ uống')).toBe('Kích hoạt lại nhóm «Đồ uống»? Nhóm sẽ xuất hiện lại trong bộ chọn của chủ quán.');
  });
});
