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

## Xung đột / quyết định cần Owner
1. **ADR-004**: UI đã duyệt cho Shipper tự tạo yêu cầu rút; ADR-004 draft ghi Admin tạo. UI không code theo bản cũ. Cần cập nhật hợp đồng nghiệp vụ/API trước giai đoạn backend.
2. Không có tab "Ví" riêng so với mockup (tránh đổi điều hướng M01/M03); cần Owner quyết nếu muốn thêm.
3. Quyền: `grantsFromPermissions` chưa cấp grant tài chính cho ADMIN thường, hiện chỉ SYSTEM thấy menu Tài chính.
4. Nhánh app: chưa có QR thật (placeholder), tải ảnh chứng từ đang khóa (chưa có image picker).

## Việc backend M04 còn lại
Bảng ví/ledger/hold/nạp/rút/adjustment; API số dư, nạp (tạo/hủy/Admin xác nhận+từ chối), rút (tạo/hủy/nhận xử lý/đã chuyển/đối soát), ledger + export, tham số ví + audit; hold/capture/release theo M07 (mỗi assignment một lần); snapshot ngân hàng khi tạo yêu cầu; quyền Admin; upload chứng từ; QR; kênh rút cho Shipper bị khóa; test tiền và phân quyền; nối `FinanceSource`/`WalletSource`.
