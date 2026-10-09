// Vietnamese copy for every error code the backend can return (apps/backend/src/common/app-errors.ts and the generic
// HTTP codes of http/error-envelope.ts). The server message is English and is never shown: the code decides the text,
// so a wording change on the server cannot leak into the UI. tests/web/error-copy.test.mjs fails when the backend adds
// a code that has no copy here.

export const SESSION_ERROR_CODES = Object.freeze(['SESSION_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED']);

const SESSION_ENDED = 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.';

export const ERROR_COPY = Object.freeze({
  // Idempotency / transaction
  IDEMPOTENCY_KEY_REQUIRED: 'Yêu cầu chưa hợp lệ (thiếu mã chống gửi lặp). Hãy tải lại trang; nếu vẫn lỗi, báo đội kỹ thuật kèm mã yêu cầu.',
  INVALID_IDEMPOTENCY_KEY: 'Yêu cầu chưa hợp lệ (mã chống gửi lặp sai). Hãy tải lại trang; nếu vẫn lỗi, báo đội kỹ thuật kèm mã yêu cầu.',
  IDEMPOTENCY_KEY_REUSED: 'Lần gửi trước đã dùng mã này với nội dung khác. Hãy tải lại hồ sơ rồi gửi lại.',
  IDEMPOTENCY_BUSY: 'Yêu cầu trước đó vẫn đang được xử lý. Đợi vài giây rồi bấm Thử lại.',
  IDEMPOTENCY_REPLAY_EXPIRED: 'Kết quả của lần gửi trước đã hết thời gian lưu. Hãy tải lại hồ sơ để xem hiện trạng trước khi gửi tiếp.',
  IDEMPOTENCY_KEY_UNAVAILABLE: 'Hệ thống tạm thời chưa nhận được yêu cầu này. Thử lại sau ít phút.',
  TRANSACTION_OUTCOME_UNKNOWN: 'Chưa xác định được yêu cầu đã được lưu hay chưa. Bấm Thử lại (giữ nguyên nội dung) để kiểm tra an toàn.',

  // Auth Core
  INVALID_PHONE: 'Số điện thoại chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912345678.',
  OTP_INVALID: 'Mã xác minh chưa đúng.',
  OTP_EXPIRED: 'Mã xác minh đã hết hạn.',
  OTP_ALREADY_USED: 'Mã xác minh đã được dùng.',
  OTP_RATE_LIMITED: 'Thao tác quá nhiều lần. Đợi một lát rồi thử lại.',
  PHONE_ALREADY_REGISTERED: 'Số điện thoại này đã được đăng ký.',
  VERIFICATION_PROOF_INVALID: 'Phiên xác minh số điện thoại không hợp lệ.',
  VERIFICATION_PROOF_USED: 'Phiên xác minh số điện thoại đã được dùng.',
  VERIFICATION_PURPOSE_MISMATCH: 'Phiên xác minh không dùng cho thao tác này.',
  INVALID_CREDENTIALS: 'Số điện thoại hoặc mật khẩu chưa đúng.',
  ACCOUNT_DISABLED: 'Tài khoản này đang bị khóa. Liên hệ đội vận hành 11Ship để được hỗ trợ.',
  ROLE_NOT_AVAILABLE: 'Vai trò này hiện chưa dùng được. Đã tải lại thông tin tài khoản.',
  SESSION_INVALID: SESSION_ENDED,
  SESSION_REVOKED: 'Phiên đăng nhập đã bị thu hồi (ví dụ tài khoản vừa chọn vai trò Quán ở thiết bị khác). Vui lòng đăng nhập lại.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  AUTH_REGISTRATION_UNAVAILABLE: 'Đăng ký và xác minh SMS tạm thời chưa mở.',

  // Shop onboarding
  SHOP_ONBOARDING_EXISTS: 'Tài khoản này đã có hồ sơ quán.',
  SHOP_PROFILE_INCOMPLETE: 'Hồ sơ quán chưa đủ điều kiện để hoàn tất. Xem các mục còn thiếu bên dưới.',
  INVALID_SERVICE_AREA: 'Khu vực phục vụ không hợp lệ hoặc đã ngừng hoạt động.',
  VERSION_CONFLICT: 'Hồ sơ vừa được thay đổi ở nơi khác. Đã tải bản mới nhất vào biểu mẫu, hãy kiểm tra rồi lưu lại.',

  // Driver onboarding
  DRIVER_PROFILE_EXISTS: 'Tài khoản này đã có hồ sơ xế.',
  DRIVER_PENDING_APPROVAL: 'Hồ sơ xế đang chờ duyệt.',

  // Shop management (M02-A): not used by this UI yet, kept so no code can reach the user without copy.
  SHOP_NOT_FOUND: 'Không tìm thấy quán của tài khoản này.',
  SHOP_ROLE_REQUIRED: 'Cần chọn vai trò Quán để thực hiện thao tác này.',
  SHOP_DISABLED: 'Quán đang bị tạm khóa.',
  INVALID_BUSINESS_HOURS: 'Giờ mở cửa chưa hợp lệ.',

  // Generic HTTP envelope codes
  BAD_REQUEST: 'Thông tin gửi lên chưa hợp lệ. Kiểm tra lại các ô đã nhập.',
  UNAUTHORIZED: SESSION_ENDED,
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
  CONFLICT: 'Dữ liệu vừa thay đổi. Tải lại rồi thử lại.',
  UNPROCESSABLE_ENTITY: 'Thông tin gửi lên chưa hợp lệ. Kiểm tra lại các ô đã nhập.',
  TOO_MANY_REQUESTS: 'Thao tác quá nhiều lần. Đợi một lát rồi thử lại.',
  SERVICE_UNAVAILABLE: 'Máy chủ tạm thời chưa phục vụ được. Thử lại sau ít phút.',
  INTERNAL_ERROR: 'Máy chủ gặp lỗi. Thử lại sau; nếu vẫn lỗi, gửi mã yêu cầu cho đội kỹ thuật.',
  CLIENT_ERROR: 'Yêu cầu chưa hợp lệ. Thử lại; nếu vẫn lỗi, gửi mã yêu cầu cho đội kỹ thuật.',
});

const TRANSPORT_COPY = Object.freeze({
  network: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  timeout: 'Máy chủ phản hồi quá lâu. Thử lại sau ít phút.',
  invalid_response: 'Máy chủ trả về dữ liệu không đọc được. Thử lại sau; nếu vẫn lỗi, báo đội kỹ thuật.',
  aborted: 'Yêu cầu đã bị hủy.',
});

const UNKNOWN_HTTP = 'Có lỗi không xác định. Thử lại; nếu vẫn lỗi, gửi mã yêu cầu cho đội kỹ thuật.';

/** True when a failed result means "the session this request used is no longer valid". */
export function isSessionFailure(failure) {
  return failure.kind === 'http' && SESSION_ERROR_CODES.includes(failure.code);
}

/** What the user is told, plus the technical detail kept behind "Chi tiết lỗi". Never includes a body or a token. */
export function describeFailure(failure) {
  if (failure.kind === 'http') {
    const message = Object.hasOwn(ERROR_COPY, failure.code) ? ERROR_COPY[failure.code] : UNKNOWN_HTTP;
    return {
      message,
      detail: { status: failure.status, code: failure.code, requestId: failure.requestId ?? null },
    };
  }
  const message = Object.hasOwn(TRANSPORT_COPY, failure.kind) ? TRANSPORT_COPY[failure.kind] : UNKNOWN_HTTP;
  return {
    message,
    detail: { status: failure.status ?? null, code: failure.kind, requestId: failure.requestId ?? null },
  };
}
