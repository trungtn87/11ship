// User-facing Vietnamese copy for the states every screen must handle (03-ui-catalog section 2, C01-C10) and for the
// failures a backend call can return. One file so the wording can change without touching logic. No sentence here says
// a thing was saved, sent, paid or activated: those words are only written from a real backend result.

export type FailureCode =
  | 'OFFLINE' // C03: the request could not reach the server
  | 'TIMEOUT' // C03
  | 'SESSION_EXPIRED' // C04
  | 'FORBIDDEN' // C05
  | 'VERSION_CONFLICT' // C06
  | 'OUTCOME_UNKNOWN' // C07
  | 'RATE_LIMITED' // C09
  | 'INVALID_PHONE'
  | 'INVALID_CREDENTIALS'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'PHONE_ALREADY_REGISTERED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_WIRED' // C10: the backend contract for this action does not exist yet
  | 'UNKNOWN';

export const STATE_COPY = {
  loading: 'Đang tải…',
  working: 'Đang xử lý…',
  offline: { title: 'Không có kết nối mạng', text: 'Vui lòng kiểm tra kết nối internet và thử lại.' },
  timeout: { title: 'Máy chủ phản hồi quá lâu', text: 'Chưa nhận được phản hồi. Vui lòng thử lại.' },
  sessionExpired: { title: 'Vui lòng đăng nhập lại', text: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để tiếp tục sử dụng ứng dụng.' },
  forbidden: { title: 'Bạn không có quyền', text: 'Tài khoản của bạn chưa được phép dùng chức năng này.' },
  conflict: { title: 'Dữ liệu đã thay đổi', text: 'Thông tin vừa được cập nhật ở nơi khác. Hãy xem phiên bản mới nhất rồi quyết định có lưu lại hay không.' },
  unknownOutcome: { title: 'Chưa xác định kết quả', text: 'Đang kiểm tra lại. Vui lòng không gửi lại cho đến khi có kết quả.' },
  empty: 'Chưa có dữ liệu để hiển thị.',
  retry: 'Thử lại',
  recheck: 'Kiểm tra lại',
  back: 'Quay lại',
  rateLimited: (clock: string) => `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${clock}.`,
  otpExpired: { title: 'Mã đã hết hạn', text: 'Vui lòng yêu cầu mã mới.' },
  otpInvalid: 'Mã không đúng. Vui lòng kiểm tra lại.',
  otpLocked: 'Bạn đã nhập sai quá số lần cho phép. Hãy yêu cầu mã mới.',
  resendIn: (clock: string) => `Gửi lại mã (${clock})`,
  resendHint: (seconds: number) => `Bạn có thể gửi lại mã sau ${seconds} giây.`,
  invalidPhone: 'Số điện thoại không hợp lệ.',
  invalidCredentials: 'Thông tin đăng nhập không đúng.',
  phoneRegistered: 'Số điện thoại này đã có tài khoản.',
  providerUnavailable: 'Chưa gửi được mã lúc này. Vui lòng thử lại sau.',
  passwordRule: 'Mật khẩu cần từ 8 đến 128 ký tự.',
  passwordMismatch: 'Hai mật khẩu chưa khớp.',
  nameInvalid: 'Nhập họ tên (tối đa 120 ký tự).',
  consentRequired: 'Bạn cần đồng ý với Điều khoản sử dụng để tiếp tục.',
  required: 'Vui lòng nhập thông tin này.',
  linkInvalid: 'Liên kết chưa hợp lệ. Hãy nhập đường dẫn bắt đầu bằng https://.',
  tooLong: (max: number) => `Tối đa ${max} ký tự.`,
  notWiredTitle: 'Chưa nối với máy chủ',
  designBanner: 'Dữ liệu minh họa',
  designNoSend: 'Chế độ xem thiết kế: thao tác này không gửi dữ liệu và không lưu gì.',
  soon: 'Sắp có',
} as const;

/** What to tell the person for a failure code. `NOT_WIRED` never reaches the person as an error: the button is disabled with its reason instead. */
export function failureMessage(code: FailureCode, retryAfterSeconds?: number): { readonly title: string; readonly text: string } {
  switch (code) {
    case 'OFFLINE':
      return STATE_COPY.offline;
    case 'TIMEOUT':
      return STATE_COPY.timeout;
    case 'SESSION_EXPIRED':
      return STATE_COPY.sessionExpired;
    case 'FORBIDDEN':
      return STATE_COPY.forbidden;
    case 'VERSION_CONFLICT':
      return STATE_COPY.conflict;
    case 'OUTCOME_UNKNOWN':
      return STATE_COPY.unknownOutcome;
    case 'RATE_LIMITED':
      return { title: 'Thử quá nhiều lần', text: retryAfterSeconds === undefined ? 'Vui lòng thử lại sau.' : STATE_COPY.rateLimited(formatClock(retryAfterSeconds)) };
    case 'INVALID_PHONE':
      return { title: STATE_COPY.invalidPhone, text: 'Nhập số di động Việt Nam gồm 10 chữ số.' };
    case 'INVALID_CREDENTIALS':
      return { title: STATE_COPY.invalidCredentials, text: 'Vui lòng kiểm tra số điện thoại và mật khẩu.' };
    case 'OTP_INVALID':
      return { title: STATE_COPY.otpInvalid, text: 'Kiểm tra mã trong tin nhắn rồi nhập lại.' };
    case 'OTP_EXPIRED':
      return STATE_COPY.otpExpired;
    case 'OTP_LOCKED':
      return { title: 'Đã nhập sai quá số lần', text: STATE_COPY.otpLocked };
    case 'PHONE_ALREADY_REGISTERED':
      return { title: STATE_COPY.phoneRegistered, text: 'Hãy đăng nhập, hoặc dùng số điện thoại khác.' };
    case 'PROVIDER_UNAVAILABLE':
      return { title: 'Chưa gửi được mã', text: STATE_COPY.providerUnavailable };
    case 'NOT_WIRED':
      return { title: STATE_COPY.notWiredTitle, text: 'Chức năng này chưa có máy chủ phục vụ.' };
    case 'UNKNOWN':
      return { title: 'Có lỗi xảy ra', text: 'Vui lòng thử lại sau.' };
  }
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
