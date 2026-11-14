import { describe, expect, it } from '@jest/globals';
import { PRIVACY_PAGE_HTML, PRIVACY_PAGE_PATH, PRIVACY_PAGE_VERSION } from './privacy-page';

describe('public privacy policy page', () => {
  it('is a self-contained, approved document without executable scripts', () => {
    expect(PRIVACY_PAGE_PATH).toBe('chinh-sach-quyen-rieng-tu');
    expect(PRIVACY_PAGE_VERSION).toBe('privacy-20261114-v3');
    expect(PRIVACY_PAGE_HTML).toContain('<html lang="vi">');
    expect(PRIVACY_PAGE_HTML).toContain('index,follow');
    expect(PRIVACY_PAGE_HTML).not.toMatch(/DỰ THẢO|CHƯA CÓ HIỆU LỰC|CHỜ OWNER/);
    expect(PRIVACY_PAGE_HTML).not.toContain('<script');
    expect(PRIVACY_PAGE_HTML).not.toContain('<form');
  });

  it('covers categories, sharing, sensitive location, data rights, retention and legal identity', () => {
    for (const item of ['Shipper', 'số điện thoại', 'tài khoản ngân hàng', 'vị trí', 'nhạy cảm', 'lưu trữ', 'xóa dữ liệu', 'đồng ý', 'Đơn vị xử lý']) {
      expect(PRIVACY_PAGE_HTML.toLocaleLowerCase('vi')).toContain(item.toLocaleLowerCase('vi'));
    }
    expect((PRIVACY_PAGE_HTML.match(/<section id=/g) ?? [])).toHaveLength(12);
    expect(PRIVACY_PAGE_HTML).toContain('href="/dieu-khoan-su-dung"');
  });
});
