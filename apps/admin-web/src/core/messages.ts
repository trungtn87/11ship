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
