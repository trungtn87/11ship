// User-facing Vietnamese copy. The first group is quoted from the approved design (M01-D-auth-UI-v1 and the UI
// handoff of 2026-10-09). The second group was not in the design text; the Owner approved it with the screenshots of
// 2026-10-09. Every string is in this one file so it can be changed without touching the logic.

export const COPY = {
  // Approved.
  invalidPhone: 'Số điện thoại không hợp lệ.',
  invalidCredentials: 'Thông tin đăng nhập không đúng.',
  totpInvalid: 'Mã không đúng hoặc đã hết hiệu lực.',
  preauthInvalid: 'Phiên xác thực không còn hợp lệ. Vui lòng đăng nhập lại.',
  preauthExpired: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.',
  unavailable: 'Chưa thể kết nối. Vui lòng thử lại.',
  lostResponse: 'Đăng nhập lại và dùng mã mới trong Authenticator.',
  // Not in the design text; approved by the Owner with the screenshots of 2026-10-09 (kept unchanged).
  stepChanged: 'Bước xác thực đã thay đổi. Vui lòng kiểm tra và tiếp tục.',
  rateLimited: (clock: string) => `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${clock}.`,
  rateLimitedOver: 'Bạn có thể thử lại.',
} as const;

/** mm:ss for a whole number of seconds (>= 0). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---- Administration screens added by M01-D-ADMIN-WEB (invitation management and ADMIN activation). ----
// NOT in the approved design text (the design covered login only): this wording is a proposal for the Owner to approve
// with the screenshots, kept in one place so it can change without touching the logic. Error wording never reveals
// whether an account exists beyond what the backend code itself says.

export const ADMIN_COPY = {
  sessionEnded: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  stepChangedAdmin: 'Dữ liệu đã thay đổi. Vui lòng kiểm tra và thử lại.',

  // Form validation
  fullNameInvalid: 'Nhập họ tên (tối đa 120 ký tự).',
  noteTooLong: 'Ghi chú tối đa 1000 ký tự.',
  reasonInvalid: 'Nhập lý do (tối đa 500 ký tự).',
  permissionsRequired: 'Chọn ít nhất một ứng dụng được xem.',

  // Step-up
  stepUpTitle: 'Xác nhận bằng Authenticator',
  stepUpHelp: 'Nhập mã 6 số hiện tại trong Authenticator để xác nhận thao tác này.',
  stepUpExpired: 'Phiên xác nhận đã hết hạn. Vui lòng kiểm tra thông tin và xác nhận lại.',
  stepUpGone: 'Phiên xác nhận không còn hiệu lực. Vui lòng xác nhận lại.',
  connectionLost: 'Chưa nhận được kết quả. Mã Authenticator chưa được gửi lại. Hãy kiểm tra rồi thử lại.',
  outcomeUnknown: 'Chưa xác nhận được kết quả. Bấm “Kiểm tra lại” để gửi lại cùng một yêu cầu (không tạo lời mời thứ hai).',
  outcomeUnknownFinal: 'Không xác nhận được kết quả. Mở danh sách lời mời để kiểm tra trước khi làm lại.',
  rateLimited: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',

  // Business conflicts (by backend code)
  pendingExists: 'Số điện thoại này đang có lời mời chưa dùng. Hãy cấp lại hoặc thu hồi lời mời đó.',
  phoneConflict: 'Số điện thoại này đã thuộc một tài khoản quản trị.',
  versionConflict: 'Lời mời đã thay đổi. Hãy tải lại chi tiết rồi thử lại.',
  notPending: 'Lời mời không còn ở trạng thái chờ kích hoạt.',
  invitationNotFound: 'Không tìm thấy lời mời.',
  inputInvalid: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.',
  idempotencyConflict: 'Yêu cầu này đã được dùng cho nội dung khác. Vui lòng bắt đầu lại.',
  notReplayable: 'Không thể hiển thị lại liên kết. Hãy cấp lại lời mời để nhận liên kết mới.',

  // Result
  linkCopied: 'Đã sao chép liên kết.',
  linkCopyFailed: 'Không sao chép được. Hãy chọn và sao chép liên kết thủ công.',

  // Activation (public)
  activateTitle: 'Kích hoạt tài khoản ADMIN',
  linkInvalid: 'Liên kết kích hoạt không hợp lệ hoặc đã hết hiệu lực.',
  linkInvalidHelp: 'Hãy liên hệ người đã mời bạn để được cấp liên kết mới.',
  sessionInvalid: 'Phiên kích hoạt đã hết hạn hoặc không còn hợp lệ.',
  sessionInvalidHelp: 'Mở lại liên kết kích hoạt để bắt đầu lại.',
  replaced: 'Liên kết này đã được thay bằng một liên kết mới.',
  replacedHelp: 'Hãy dùng liên kết mới nhất bạn được gửi.',
  phoneConflictActivation: 'Không thể kích hoạt vì số điện thoại đã thuộc một tài khoản khác.',
  phoneConflictHelp: 'Hãy liên hệ người đã mời bạn.',
  attemptsExhausted: 'Bạn đã nhập sai quá số lần cho phép ở bước này.',
  linkUnavailable: 'Lời mời này không còn khả dụng.',
  restart: 'Bắt đầu lại',
  restartUnknown: 'Chưa xác nhận được việc bắt đầu lại. Hệ thống không tự gửi lại yêu cầu. Bấm “Kiểm tra lại trạng thái” để đọc lại.',
  rereadState: 'Kiểm tra lại trạng thái',
  retryWait: (clock: string) => `Có thể kiểm tra lại sau ${clock}.`,
  restartHelp: 'Bắt đầu một lượt kích hoạt mới từ cùng liên kết.',
  otpInvalid: 'Mã không đúng. Vui lòng kiểm tra lại.',
  otpExpired: 'Mã đã hết hạn. Hãy gửi mã mới.',
  otpLocked: 'Đã nhập sai quá số lần. Hãy bắt đầu lại.',
  otpResendWait: (clock: string) => `Có thể gửi lại mã sau ${clock}.`,
  otpSent: 'Mã đã được gửi tới số điện thoại của bạn.',
  otpTestDisplay: 'Môi trường thử nghiệm: mã không gửi tin nhắn thật.',
  passwordInvalid: 'Mật khẩu cần từ 8 đến 128 ký tự.',
  passwordExpired: 'Đã quá thời hạn đặt mật khẩu. Hãy bắt đầu lại.',
  passwordMismatch: 'Hai mật khẩu chưa khớp.',
  activationDone: 'Tài khoản đã được kích hoạt.',
  activationDoneHelp: 'Hãy đăng nhập bằng số điện thoại, mật khẩu và mã Authenticator.',
  goToLogin: 'Đến trang đăng nhập',
} as const;
