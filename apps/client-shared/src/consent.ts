// The consent the 11Food register screen shows and sends (M01.07). The pair of versions and the two texts are the ones the Owner
// approved for local development and tests (docs/tasks/M01-03-customer-register-local-handoff.md §3, approval 11/10/2026). They are
// NOT a production policy and the server decides whether it accepts the pair (CONSENT_VERSION_UNSUPPORTED otherwise): this file
// never lets the screen claim an acceptance the server did not take. The texts are shown in full, before the form is submitted.

export interface ConsentOffer {
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly termsTitle: string;
  readonly termsText: string;
  readonly privacyTitle: string;
  readonly privacyText: string;
  /** Label of the single checkbox (unchecked by default). */
  readonly checkboxLabel: string;
}

export const FOOD_TEST_CONSENT: ConsentOffer = {
  termsVersion: 'test-terms-20261011-v1',
  privacyVersion: 'test-privacy-20261011-v1',
  termsTitle: 'Điều khoản dùng thử',
  termsText:
    'Đây là bản thử nghiệm 11Ship/11Food để kiểm tra đăng ký, đăng nhập và quản lý tài khoản. Chỉ sử dụng dữ liệu thử. Mã OTP được lấy từ công cụ SMS test trên máy tính, chưa gửi SMS đến điện thoại. Việc tạo tài khoản chưa kích hoạt cửa hàng hoặc quyền nhận đơn của shipper.',
  privacyTitle: 'Thông tin dữ liệu thử nghiệm',
  privacyText:
    'Bản thử nghiệm lưu số điện thoại, tên bạn nhập, mật khẩu ở dạng băm, phiên đăng nhập và thời điểm/cặp phiên bản bạn chấp thuận để kiểm tra chức năng tài khoản. Không nhập thông tin nhạy cảm hoặc dùng mật khẩu đang dùng ở dịch vụ khác. Nội dung này chỉ dùng cho môi trường thử nghiệm, chưa phải chính sách phát hành chính thức.',
  checkboxLabel: 'Tôi đồng ý với Điều khoản dùng thử và Thông tin dữ liệu thử nghiệm.',
};
