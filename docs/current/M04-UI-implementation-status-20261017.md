# M04 — Trạng thái triển khai UI (17/10/2026)

Nhánh `feat/m04-ui-wallet`. **UI only**: không logic tiền, không API mới, không đổi DB, không đụng luồng đơn M07. Chờ Owner nghiệm thu UI; chưa mở backend.

## Đã làm
- Admin Web: 8 màn Tài chính (A01–A07, gồm chi tiết nạp/rút) + Cài đặt → Tham số hệ thống → Ví Shipper (mặc định 100.000đ / 10.000đ / 1.000đ mỗi đơn, chưa lưu DB). Menu nhóm Tài chính 6 mục.
- App Shipper: 7 màn (S01–S07). Lối vào ở Thu nhập và Tài khoản; 5 tab chính không đổi.
- Bản thật: nguồn `NOT_WIRED` / `NotWiredWalletSource`; không số dư giả, nút tiền khóa kèm lý do. Dữ liệu minh họa chỉ ở bản design-preview (Admin) và khi build với `--dart-define=M04_UI_PREVIEW=true` (app), luôn có nhãn "dữ liệu minh họa".
- Mã sẵn để nối API: `FinanceSource` (Admin) và `WalletSource` (app).

## Kiểm chứng
- Admin Web: typecheck sạch, `node --test tests/admin-web/*.test.mjs` 23/23, kiểm tra bản thật không chứa dữ liệu mẫu/fetch/storage trong file finance, xem trình duyệt Chromium (1440px và 390px). Jest chạy qua CI (máy này không `npm ci` được).
- Flutter: **chưa biên dịch/chạy/analyze** (không có Flutter SDK). Chưa có APK. Cần CI/máy có Flutter chạy `flutter analyze` và `flutter test` (có 19 test mới).

## Quyết định Owner (17/10/2026) — đã đưa vào tài liệu/mã
1. Shipper tự tạo yêu cầu nạp/rút trên App, Admin xử lý trên Web. `ADR-004-driver-wallet-consistency.md` bản 0.2 ghi phần thay đổi so với draft 07/10. UI không triển khai API tiền.
2. Giữ nguyên 5 tab App Shipper; ví vào từ Thu nhập và Tài khoản.
3. Quyền tài chính ADMIN do SYSTEM cấp từng chức năng (grant `driver-wallets`, `topups`, `withdrawals`, `parameters` trong `core/menu.ts`). Không hardcode cho mọi ADMIN. **Dependency M04 backend:** `GET /v1/admin-auth/permissions` chưa phát các grant này, nên hiện chỉ SYSTEM thấy menu Tài chính; cần backend phân quyền theo chức năng và `grantsFromPermissions` đọc chúng.

## Sửa sau review (17/10/2026)
- Flutter `ambiguous_export`: `formatVnd` của M04 trùng `formatVnd` của M02 trong `n11_shared`. Đổi helper M04 thành `formatWalletVnd`/`formatWalletVndSigned`; M02 không đổi.
- Admin Web hosting: thêm toàn bộ route M04 vào allowlist backend (`admin-web-hosting.ts` + spec) và dev server (`admin-web-dev.mjs`); thông số bảo mật giữ nguyên (chỉ route chính xác, chi tiết chỉ nhận UUID, đường dẫn lạ vẫn 404). Đã mở trực tiếp/reload 11 trang trong Chromium: 200; chưa đăng nhập ra màn đăng nhập; `/finance/nope` 404.

## Còn mở
- QR thật (placeholder), tải ảnh chứng từ (khóa, chưa có image picker), kênh rút cho Shipper không đăng nhập được.
- Kết quả CI Flutter/APK: xem PR #124.

## Việc backend M04 còn lại
Bảng ví/ledger/hold/nạp/rút/adjustment; API số dư, nạp (tạo/hủy/Admin xác nhận+từ chối), rút (tạo/hủy/nhận xử lý/đã chuyển/đối soát), ledger + export, tham số ví + audit; hold/capture/release theo M07 (mỗi assignment một lần); snapshot ngân hàng khi tạo yêu cầu; quyền Admin; upload chứng từ; QR; kênh rút cho Shipper bị khóa; test tiền và phân quyền; nối `FinanceSource`/`WalletSource`.
