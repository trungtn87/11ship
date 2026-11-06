# 11Ship — Baseline kỹ thuật / vận hành / bảo mật

**Trạng thái: DRAFT chờ Owner duyệt nội dung.** Owner 2026-11-06 (OD-24) chọn đặt tại `docs/process/`. Mô tả hành vi mà code **hiện làm** tại `main` `d2d392e`, đọc tĩnh, chưa chạy runtime (NOT TESTED). Không phải Functional Baseline.

## Các mục

| ID | Chủ đề | Hành vi (theo code) | Nguồn code |
|---|---|---|---|
| T-01 | Đối soát lệch sổ ví | Màn đối soát chỉ đọc: số ví đã kiểm, số ví lệch, số lệnh rút lệch/đang đối soát, danh sách tối đa 100 ví lệch (số dư, tiền hold, tổng sổ cái, số dư sau cùng, tổng hold đang hoạt động). Lệnh chạy kiểm tra cần quyền đối soát rút tiền, dùng CSRF và `Idempotency-Key`; chỉ **ghi nhận phát hiện** (audit và sự kiện `wallet.drift.detected.v1`) khi có lệch, **không bao giờ sửa** số dư, hold hay sổ cái. | `admin-finance-read-service.ts:144-216` |
| T-02 | Header truyền tải của API Admin và client-auth | Mọi phản hồi của `/v1/admin-auth`, `/v1/admin`, `/v1/client-auth` và các tuyến dữ liệu cá nhân (`customer/me/profile`, `customers/me`, `driver/me`, `onboarding/shop/service-areas`) mang `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Middleware cài trước bộ parse body nên lỗi JSON hoặc body quá lớn cũng mang header. Middleware chỉ đặt header, không đọc body, không quyết Origin/CSRF/phiên. | `http/admin-transport.middleware.ts`; `http/client-auth-transport.middleware.ts:1-25` |
