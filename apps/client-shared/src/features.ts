// Which business actions of the phone apps are connected to a real backend. This is the single place the UI reads to
// decide "button enabled" vs "button disabled with its reason" (03-ui-catalog C10). Nothing here is fake: an action that is
// not wired is NOT simulated, it is disabled and says why.
//
// To connect an action later: implement its port (ports.ts), flip `wired` to true here, and add the test. The screens do
// not change. `package` names the work package of the design set that delivers the missing piece.

export type FeatureId =
  | 'auth.register'
  | 'auth.registerOtp'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.resetRequest'
  | 'auth.resetOtp'
  | 'auth.resetComplete'
  | 'customer.profileSave'
  | 'shop.draftSave'
  | 'shop.location'
  | 'shop.complete'
  | 'driver.submit'
  | 'driver.statusRead'
  | 'account.read';

export interface FeatureStatus {
  readonly wired: boolean;
  /** Visible reason shown next to the disabled control. Vietnamese, says what is missing, never "error". */
  readonly reason: string;
  /** Design-set work package that delivers the missing backend/contract piece (for the docs and the PR evidence). */
  readonly package: string;
}

const waitingAuth = (what: string, pkg: string): FeatureStatus => ({
  wired: false,
  reason: `Chưa nối máy chủ: ${what} đang chờ backend (${pkg}).`,
  package: pkg,
});

export const FEATURES: Readonly<Record<FeatureId, FeatureStatus>> = {
  'auth.register': waitingAuth('đăng ký tài khoản', 'M01.03'),
  'auth.registerOtp': waitingAuth('xác minh mã OTP đăng ký', 'M01.03'),
  'auth.login': waitingAuth('đăng nhập', 'M01.04'),
  'auth.logout': waitingAuth('đăng xuất trên máy chủ', 'M01.04'),
  'auth.resetRequest': waitingAuth('gửi mã đặt lại mật khẩu', 'M01.16'),
  'auth.resetOtp': waitingAuth('xác minh mã đặt lại mật khẩu', 'M01.16'),
  'auth.resetComplete': waitingAuth('đặt lại mật khẩu', 'M01.16'),
  'customer.profileSave': waitingAuth('lưu hồ sơ cá nhân', 'M01.05'),
  'shop.draftSave': waitingAuth('lưu hồ sơ cửa hàng', 'M01.11'),
  'shop.location': waitingAuth('xác nhận vị trí lấy hàng', 'M01.12'),
  'shop.complete': waitingAuth('hoàn tất hồ sơ cửa hàng', 'M01.12'),
  'driver.submit': waitingAuth('gửi hồ sơ shipper', 'M01.10'),
  'driver.statusRead': waitingAuth('đọc trạng thái hồ sơ shipper', 'M01.05'),
  'account.read': waitingAuth('đọc thông tin tài khoản', 'M01.04'),
};

export function featureStatus(id: FeatureId): FeatureStatus {
  return FEATURES[id];
}

export function isWired(id: FeatureId): boolean {
  return FEATURES[id].wired;
}
