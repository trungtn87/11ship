# OD-17 — Requirement nháp từ code (chờ Owner duyệt nội dung)

**Trạng thái: DRAFT. Chưa phải baseline.** Tài liệu này mô tả hành vi mà code **hiện làm** tại `main` `85467a8`, để Owner quyết định có đưa vào Functional Baseline (`requirements.md`) hay không. Mọi dòng là đọc tĩnh source, chưa chạy runtime (NOT TESTED). Claude Lead không tự quyết nghiệp vụ: các điểm cần Owner chọn nằm ở mục "Câu hỏi cho Owner".

Phạm vi theo OD-17 (Owner 2026-11-05): chính sách hoa hồng → requirement chức năng M04; kiểm duyệt đánh giá → M11; đối soát lệch sổ và middleware truyền tải → baseline kỹ thuật/ops/bảo mật; **mức nạp/rút tối thiểu không được đưa vào** (policy chưa duyệt).

## A. Đề xuất đưa vào Functional Baseline

Cột theo định dạng `requirements.md` (ID, module, tên, entry point, hành vi, dữ liệu, ai làm, lỗi, nguồn). ID là đề xuất.

| ID | Module | Tên | Entry point | Hành vi (theo code) | Dữ liệu | Ai | Lỗi | Nguồn code |
|---|---|---|---|---|---|---|---|---|
| M04-R-16 (đề xuất) | M04 | Chính sách hoa hồng theo phiên bản | Admin Web `GET/POST /v1/admin/finance/commission-policy` | Hoa hồng là một số tiền VND cố định cho mỗi đơn giao, 1 đến 1 000 000 000. Chính sách có phiên bản liên tiếp, chỉ thêm không sửa; phiên bản 1 là bản seed 1 000 VND. Khi shipper nhận đơn, hoa hồng đang hiệu lực được chụp vào assignment (số tiền và nhãn `COMMISSION_V<n>`) và giữ (hold) trong cùng giao dịch; đổi chính sách sau đó **không** ảnh hưởng assignment đã nhận. Giao thành công thì hold được thu đúng một lần; hủy nhận thì hold được trả. Shipper chỉ bật nhận đơn khi số dư khả dụng (số dư trừ hold) đủ hoa hồng đang hiệu lực. | `wallet_commission_policies` (policy_version, commission_vnd, created_by_user_id); snapshot trên assignment | Chỉ SYSTEM đổi; ADMIN có quyền ví đọc được | Sai `expected_version` hoặc cùng số tiền → `COMMISSION_POLICY_VERSION_CONFLICT`; thiếu quyền → 403 | `admin-finance-read-service.ts:221-275`; migration `1795132800000_create-wallet-withdrawals.sql:36-74`; `delivery-shipper-service.ts:235-252,568`; `wallet-driver-port.ts:12` |
| M11-R-11 (đề xuất) | M11 | Admin ẩn/khôi phục đánh giá | Admin Web `GET /v1/admin/reviews`, `GET .../reviews/:id`, `POST .../reviews/:id/actions/{hide,restore}` | Admin có quyền xử lý ẩn một đánh giá hoặc khôi phục lại, bắt buộc có mã lý do (`WRONG_ORDER`, `ABUSIVE`, `PERSONAL_DATA`, `SPAM`, `VERIFIED_FALSE`, `MISTAKE_RESOLVED`, `OTHER`); `OTHER` bắt buộc ghi chú (tối đa 500 ký tự). Số sao và nội dung gốc được giữ; đánh giá bị ẩn không tính vào tổng. Phạm vi theo loại: đánh giá quán (`SHOP_BY_CUSTOMER`) cần phạm vi shop, đánh giá shipper cần phạm vi shipper. Ẩn đã ẩn hoặc khôi phục đã hiện bị từ chối. Mỗi thao tác ghi một dòng moderation (chỉ thêm) và audit; dùng `Idempotency-Key` và `expected_version`. | `reviews.visibility`, `review_moderations` (HIDE/RESTORE, reason_code, reason_note, actor) | ADMIN có quyền xử lý, đúng phạm vi | Lệch version → `VERSION_CONFLICT`; đã ở trạng thái đích → `ADMIN_ACTION_NOT_ALLOWED`; ngoài phạm vi → `REVIEW_NOT_FOUND` | `admin-feedback-service.ts:112-155`; `feedback-constants.ts:86`; migration `1794355200000_create-m11-reviews-complaints.sql:86-105`; `review-repository.ts:285-299` |

## B. Đề xuất đưa vào baseline kỹ thuật/ops/bảo mật (không phải Functional Baseline)

Chưa có tài liệu "technical/ops/security baseline" trong repo. Đề xuất gom hai mục dưới đây vào một tài liệu như vậy (Owner quyết vị trí).

| ID | Chủ đề | Hành vi (theo code) | Nguồn code |
|---|---|---|---|
| T-01 (đề xuất) | Đối soát lệch sổ ví | Màn đối soát chỉ đọc: số ví đã kiểm, số ví lệch, số lệnh rút lệch/đang đối soát, danh sách tối đa 100 ví lệch (số dư, tiền hold, tổng sổ cái, số dư sau cùng, tổng hold đang hoạt động). Lệnh chạy kiểm tra cần quyền đối soát rút tiền, dùng CSRF và `Idempotency-Key`; chỉ **ghi nhận phát hiện** (audit và sự kiện `wallet.drift.detected.v1`) khi có lệch, **không bao giờ sửa** số dư, hold hay sổ cái. | `admin-finance-read-service.ts:144-216` |
| T-02 (đề xuất) | Header truyền tải của API Admin và client-auth | Mọi phản hồi của `/v1/admin-auth`, `/v1/admin`, `/v1/client-auth` và các tuyến dữ liệu cá nhân (`customer/me/profile`, `customers/me`, `driver/me`, `onboarding/shop/service-areas`) mang `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Middleware cài trước bộ parse body nên lỗi JSON hoặc body quá lớn cũng mang header. Middleware chỉ đặt header, không đọc body, không quyết Origin/CSRF/phiên. | `http/admin-transport.middleware.ts`; `http/client-auth-transport.middleware.ts:1-25` |

## C. Không đưa vào

- **Mức nạp/rút tối thiểu** (`shipper_wallet_parameters`): policy chưa được Owner duyệt (OD-17). Lưu ý để tránh nhầm: bảng này cũng có `topup_min_vnd` được dùng cho readiness nhận đơn (`wallet-driver-port.ts:31-46`, liên quan M03-R-02).

## D. Câu hỏi cho Owner

1. **Hoa hồng:** (a) duyệt mô tả M04-R-16 như trên? (b) số seed 1 000 VND cố định mỗi đơn có phải mức chính thức, hay chỉ giá trị khởi tạo chờ Owner đặt? (c) hoa hồng có phải hiển thị cho shipper trước khi nhận đơn không (code chưa được đọc về phần hiển thị, UNKNOWN)?
2. **Kiểm duyệt đánh giá:** (a) duyệt M11-R-11? (b) người bị đánh giá (quán/shipper) và khách có được thông báo khi đánh giá bị ẩn hoặc khôi phục không? Code đã đọc chưa thấy gửi thông báo (UNKNOWN, chưa quét hết).
3. **T-01, T-02:** đồng ý tạo tài liệu technical/ops/security baseline để chứa hai mục này, hay đặt vào `docs/process/`?

Sau khi Owner trả lời, Claude Lead sẽ đưa các dòng đã duyệt vào `requirements.md` (hoặc tài liệu kỹ thuật) trong một PR tài liệu riêng và xóa tệp nháp này.
