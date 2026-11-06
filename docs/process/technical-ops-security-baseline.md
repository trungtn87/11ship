# 11Ship — Baseline kỹ thuật / vận hành / bảo mật

**Trạng thái: DRAFT chờ Owner duyệt nội dung.** Owner 2026-11-06 (OD-24) chọn đặt tại `docs/process/`. Mô tả hành vi mà code **hiện làm** tại `main` `d2d392e` (kiểm lại `app.setup.ts` ở cùng mốc), đọc tĩnh, chưa chạy runtime (NOT TESTED). Không phải Functional Baseline.

## Các mục

| ID | Chủ đề | Hành vi (theo code) | Nguồn code |
|---|---|---|---|
| T-01 | Đối soát lệch sổ ví | Màn đối soát chỉ đọc: số ví đã kiểm, số ví lệch, số lệnh rút lệch/đang đối soát, danh sách tối đa 100 ví lệch (số dư, tiền hold, tổng sổ cái, số dư sau cùng, tổng hold đang hoạt động). Lệnh chạy kiểm tra cần quyền đối soát rút tiền, dùng CSRF và `Idempotency-Key`; chỉ **ghi nhận phát hiện** (audit và sự kiện `wallet.drift.detected.v1`) khi có lệch, **không bao giờ sửa** số dư, hold hay sổ cái. | `admin-finance-read-service.ts:144-216` |
| T-02 | Header truyền tải của API Admin và client | Các phản hồi dưới những prefix sau mang `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`: `/v1/admin-auth` và `/v1/admin` (`adminTransportMiddleware`); `/v1/client-auth`, `/v1/account-recovery`, `/v1/admin-recovery`, `/v1/sms-gateway`, `/v1/ops`, `/v1/app-updates`, `/v1/shop/me`, `/v1/notifications`, `/v1/driver/complaints`, `/v1/driver/reviews` và các prefix dữ liệu cá nhân `customer/me/profile`, `customers/me`, `driver/me`, `onboarding/shop/service-areas` (`clientAuthTransportMiddleware`); `/v1/admin-activation` dùng `activationTransportMiddleware` riêng (chưa mô tả ở đây). Danh sách canonical là `configureApp`; nếu có khác biệt thì `app.setup.ts` đúng. Mỗi prefix được cài riêng vì Express chỉ khớp theo nguyên đoạn đường dẫn. Middleware được cài trước bộ parse body, nên lỗi JSON hoặc body quá lớn cũng mang header; chỉ đặt header, không đọc body, không quyết Origin/CSRF/phiên | `app.setup.ts:28-51,88-90,120`; `http/admin-transport.middleware.ts`; `http/client-auth-transport.middleware.ts` |
