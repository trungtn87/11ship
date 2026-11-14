import { PRIVACY_PAGE_HTML, PRIVACY_PAGE_PATH, PRIVACY_PAGE_VERSION } from './privacy-page';

describe('public privacy draft page', () => {
  it('is a self-contained, clearly marked draft without executable scripts', () => {
    expect(PRIVACY_PAGE_PATH).toBe('chinh-sach-quyen-rieng-tu');
    expect(PRIVACY_PAGE_VERSION).toBe('privacy-20261112-draft-v3');
    expect(PRIVACY_PAGE_HTML).toContain('<html lang="vi">');
    expect(PRIVACY_PAGE_HTML).toContain('noindex,nofollow');
    expect(PRIVACY_PAGE_HTML).toContain('BẢN DỰ THẢO — CHƯA CÓ HIỆU LỰC');
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
