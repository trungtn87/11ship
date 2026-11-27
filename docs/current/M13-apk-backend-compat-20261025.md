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
- Chủ quán (11Food): `busyProbe` đọc **số đơn quán đang xử lý từ máy chủ** (`counts` của danh sách đơn: đang chuẩn bị, hẹn giờ, đang giao, cần xử lý). Có đơn → chỉ banner, không khóa ngang; xong hết → hiện màn cập nhật. Đơn **chờ nhận** không giữ cập nhật lại, nhưng khi biết có bản bắt buộc quán **không xác nhận được đơn mới** (vẫn từ chối được; đơn đã nhận xử lý bình thường). Không đọc được trạng thái, hoặc phiên chưa xác định → coi là **bận**, không bao giờ suy ra rảnh; chỉ khách chưa đăng nhập hoặc tài khoản không có quán mới được coi là rảnh. Chưa thử trên máy thật.
- Chưa có số tài khoản/máy dùng bản cũ theo thời gian ngoài `ops_version_reports` M13 hiện có.

## 5. Bản Google Play (không có tệp APK)

Khi app lên Google Play không còn APK trong `OPS_ARTIFACT_DIR`. Đặt `OPS_STORE_URL_FOOD` / `OPS_STORE_URL_SHIP` (đúng `https://play.google.com/store/apps/details?id=vn.eleven.food|ship`, sai thì backend không khởi động) và đăng ký trong Web Admin một release FOOD/SHIP **không kèm tệp** (version_code là versionCode bản Play). Bản đó được mời khi app đã đặt link; `/check` trả thêm `store_url` (chỉ cho bản không tệp) và popup Android hiện nút **Cập nhật** mở trang Play. Không đặt link thì bản không tệp không bao giờ được mời.

### 5.1 iOS (App Store)

Release catalog chỉ có Android, nên iOS không đi qua bảng release. Thay vào đó backend đọc 4 biến tuỳ chọn (không có biến nào thì iOS không được mời bản mới):

| Biến | Giá trị | Sai định dạng |
| --- | --- | --- |
| `OPS_STORE_URL_FOOD_IOS` | `https://apps.apple.com/vn/app/<slug>/id<số>` (bắt buộc có `/vn/`; không query, fragment, user hay port; tối đa 200 ký tự) | backend không khởi động, báo đúng tên biến |
| `OPS_STORE_URL_SHIP_IOS` | như trên, của 11Ship | như trên |
| `OPS_IOS_LATEST_BUILD_FOOD` | số nguyên dương: build number mới nhất của 11Food đã lên App Store | như trên |
| `OPS_IOS_LATEST_BUILD_SHIP` | như trên, của 11Ship | như trên |

Giá trị dự kiến cho VPS (Owner tự đặt trong môi trường; không ghi vào tệp cấu hình trong repo): 11Food `https://apps.apple.com/vn/app/11food/id6836866599`; 11Ship `https://apps.apple.com/vn/app/11ship/id6836868854`.

`GET /v1/app-updates/check` nhận thêm `platform=ANDROID|IOS` (mặc định `ANDROID`; giá trị khác bị từ chối). Với `IOS`: `update_available` = `version_code` của máy < `OPS_IOS_LATEST_BUILD_<APP>`; `store_url` là link App Store; `release.version_code` là build đó, `release.version_name` là `null` (chưa có biến tên bản iOS). Thiếu một trong hai biến của app đó, hoặc máy không gửi build number, thì trả "không có bản mới" với `store_url` null. Đường iOS không bao giờ trả `required=true` và không đối chiếu ma trận tương thích Android.

Máy iOS gửi build number là `BUILD_NUMBER` lúc build, cùng giá trị với `--build-number` khi đẩy lên TestFlight/App Store (`mobile/tool/ios-testflight.sh`). Build `1` trong CI mô phỏng iOS không bao giờ lên cửa hàng nên không ảnh hưởng.

**Owner cập nhật mỗi lần đưa build iOS mới lên App Store:**
1. Đọc build number vừa đẩy lên (chính là `APP_VERSION_CODE` của lần build TestFlight).
2. Đặt `OPS_IOS_LATEST_BUILD_FOOD` (hoặc `_SHIP`) bằng số đó trong môi trường của VPS.
3. Khởi động lại backend để đọc biến mới (ví dụ theo runbook deploy VPS). Biến chỉ được đọc lúc khởi động.
4. Kiểm tra: `GET /v1/app-updates/check?component=FOOD&version_code=<build cũ>&platform=IOS` trả `update_available: true` và `store_url` đúng.

Nếu bản mới trên App Store không được mời ngay sau khi đặt biến, kiểm tra lại bước 3 (backend chưa khởi động lại) trước khi sửa gì khác. Đặt build mới chỉ khi bản đó đã được Apple duyệt và có trên App Store; đặt sớm hơn sẽ mời người dùng tới trang chưa có bản đó.
