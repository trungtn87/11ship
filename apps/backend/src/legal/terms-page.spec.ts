import { describe, expect, it } from '@jest/globals';
import { TERMS_PAGE_HTML, TERMS_PAGE_PATH, TERMS_PAGE_VERSION } from './terms-page';

describe('public terms draft page', () => {
  it('is a self-contained Vietnamese document with a visible not-effective banner', () => {
    expect(TERMS_PAGE_PATH).toBe('dieu-khoan-su-dung');
    expect(TERMS_PAGE_VERSION).toBe('terms-20261112-draft-v3');
    expect(TERMS_PAGE_HTML).toContain('<html lang="vi">');
    expect(TERMS_PAGE_HTML).toContain('noindex,nofollow');
    expect(TERMS_PAGE_HTML).toContain('BẢN DỰ THẢO — CHƯA CÓ HIỆU LỰC');
    expect(TERMS_PAGE_HTML).not.toContain('<script');
    expect(TERMS_PAGE_HTML).not.toContain('<form');
  });
  it('covers all roles, money, privacy, complaints and account deletion', () => {
    for (const topic of ['khách hàng', 'chủ quán', 'shipper', 'Tiền thu hộ', 'hoàn tiền', 'Dữ liệu cá nhân', 'khiếu nại', 'xóa tài khoản']) {
      expect(TERMS_PAGE_HTML.toLowerCase()).toContain(topic.toLowerCase());
    }
    expect((TERMS_PAGE_HTML.match(/<section id=/g) ?? []).length).toBe(16);
  });
});
