# M13 — Tương thích APK–backend (#193, 25/10/2026)

Hoàn thiện M13 hiện có (#181), không làm lại. Không khẳng định VPS/thiết bị đã chạy; chưa deploy, chưa migrate, chưa publish release.

## 1. Nguồn sự thật và compatibility matrix

`apps/backend/src/ops/app-compatibility.json` đi **cùng bản build backend**: mức `min_client_version_code` mà backend đang chạy đòi hỏi, riêng `FOOD` và `SHIP` (versionCode hai app không chung ngưỡng), kèm `contract_revision` và `reason` (tiếng Việt, hiện cho người dùng; bắt buộc khi min > 1). Đổi file này = đổi hợp đồng, đi qua PR + preflight, không chỉnh tay trên VPS.

| Nguồn | Cho biết |
|---|---|
| `app-compatibility.json` | backend tối thiểu cần client versionCode nào |
| Danh mục release (`app.ops_releases`, SYSTEM, có audit) | APK đã `PUBLISHED`, tệp, SHA-256, kích thước, `priority`, `min_supported_version_code` |
| `GET /v1/app-updates/compatibility` (public, chỉ đọc) | ma trận đang áp dụng + APK mới nhất tải được + `satisfied` cho từng app |
| `GET /v1/app-updates/check` | kết luận cho một máy: `status` = `COMPATIBLE` / `UPDATE_OPTIONAL` / `UPDATE_REQUIRED` / `UPDATE_REQUIRED_UNAVAILABLE` / `UNKNOWN_VERSION` |

Kết luận cho máy: dưới `min_client_version_code` hoặc dưới mức của release `REQUIRED` → bắt buộc. Có bản mới nhưng máy vẫn trên mức tối thiểu → chỉ khuyến nghị. **Chỉ mời tải khi tệp thật sự có trong `OPS_ARTIFACT_DIR` đúng kích thước.** Backend đòi bản cao hơn nhưng không có APK tải được → `UPDATE_REQUIRED_UNAVAILABLE` (không bao giờ "đã mới nhất", không có link), đồng thời check vận hành `app_compat.food|ship` mở sự cố CRITICAL cho SYSTEM (`COMPAT_NO_PUBLISHED_APK`, `COMPAT_APK_TOO_OLD`, `COMPAT_ARTIFACT_MISSING`). Web Admin → Phiên bản & cập nhật hiển thị dòng "Tương thích với backend".

SYSTEM không thể `withdraw` bản duy nhất còn đáp ứng mức tối thiểu (`OPS_RELEASE_WITHDRAW_BLOCKED`). Publish vẫn đo lại tệp (SHA-256/kích thước) như M13.

## 2. Quy trình nâng mức tối thiểu (thay đổi breaking)

1. Giữ **API cũ chạy song song** (giai đoạn chuyển tiếp) — banner không sửa được API gãy.
2. Build APK có versionCode ≥ mức mới (cùng applicationId, cùng khóa ký, versionCode tăng), copy vào `OPS_ARTIFACT_DIR`, SYSTEM đăng ký và **publish**.
3. Sửa `app-compatibility.json` (tăng `contract_revision`, min mới, `reason`) trong PR.
4. Deploy: bước **APK compatibility preflight** (`scripts/deploy/check-app-compat.mjs --live <origin>`) so ma trận mới với production; **chặn promote** nếu có app tăng min mà chưa có APK `PUBLISHED` tải được ≥ min mới (hoặc không đọc được production). Không có cờ bỏ qua.
5. Sau deploy: `--after` kiểm production đã phục vụ ma trận mới và máy ở `min-1` nhận `UPDATE_REQUIRED` kèm bản tải được.
6. Báo cáo deploy ghi bảng ma trận (từ bước 4) vào step summary.

CI: `check-app-compat.mjs --static` (hình dạng file), `tests/deploy/app-compat-preflight.test.mjs`, `ops-compat.spec.ts`, `m13-app-compat.int.spec.ts` (PG thật); `mobile-apk.yml` chạy khi file ma trận đổi.

## 3. Trên điện thoại

Cold start gọi `/check` (không cần đăng nhập); resume dùng giới hạn 30 phút; **check không trả lời được thì thử lại sau 2 phút** (không giấu bản cập nhật 30 phút, không suy ra "cũ", không đăng xuất). Tài khoản có dòng **Kiểm tra cập nhật**. Bắt buộc: màn "Ứng dụng cần cập nhật để tiếp tục sử dụng"; khi chưa có tệp tải: màn giải thích + "Kiểm tra lại", không nút tải. Đang có đơn: chỉ banner, không khóa ngang. **11Ship: khi biết có bản bắt buộc, công tắc Online từ chối bật (nêu lý do) và shipper đang online bị chuyển sang không nhận đơn mới**; đơn đang làm và chia sẻ vị trí cho đơn đó giữ nguyên (M14). Giữ phiên, applicationId, khóa ký, versionCode tăng, kiểm tra kích thước + SHA-256 (M13).

## 4. Chưa làm / giới hạn

- Chưa kiểm trên máy thật/VPS; chưa publish release nào; `OPS_ARTIFACT_DIR` và việc kích hoạt vẫn theo `M13-owner-checklist-20261023.md`.
- Backend không gắn header phiên bản vào mọi API nên **không tự từ chối từng request của APK cũ**; bảo vệ là bước 1 (API tương thích) + preflight.
- Chủ quán (11Food) có đơn đang xử lý: màn bắt buộc đã hoãn theo `busyProbe`; 11Food hiện không truyền `busyProbe` (chưa có nguồn "đang xử lý đơn" trong app) — cần quyết định riêng nếu muốn hoãn cho chủ quán.
- Chưa có số tài khoản/máy dùng bản cũ theo thời gian ngoài `ops_version_reports` M13 hiện có.
