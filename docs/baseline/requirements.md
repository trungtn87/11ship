# 11Ship — Functional Baseline (B-01)

**Phiên bản:** v0.4 (áp review Codex B-02; C-01..C-15 đã chốt, C-16..C-20 chờ Owner) · **Ngày lập:** 2026-11-01 · **Cập nhật quyết định Owner:** 2026-11-01 · **Người lập:** Claude Lead, cập nhật quyết định Owner
**Trạng thái:** DRAFT — Owner đã xác nhận C-01…C-15 ngày 01/11/2026; chờ Codex/Antigravity phản biện độc lập và hoàn tất B-04. **Chưa merge PR #298; chưa xác nhận code/runtime đạt baseline.**
**Mốc tài liệu nguồn:** `main` tại `fb3ba2c` (sau #297). Baseline SHA chính thức do luồng đóng Phase 0 ghim.

## 0. Cách đọc tài liệu

Tài liệu này trả lời câu hỏi **"hệ thống phải làm gì"**. Nó không mô tả code đang làm gì.

- **Nguồn được dùng (loại A):** `docs/current/*`, ADR-001…004, handoff G02–G25, issue/PR đã đóng có quyết định Owner, các issue OWNER LOCK #251–#265, và hai issue lỗi #294 và #295.
- **Thứ tự ưu tiên khi nguồn mâu thuẫn:** (1) quyết định Owner mới nhất trong issue/PR → (2) OWNER LOCK #251–#265 và handoff G02–G25 → (3) `docs/current` theo ngày. Chỗ nào chưa tự giải quyết được thì ghi vào **Conflict Register (mục 16)** để Owner quyết.
- **Không dùng làm nguồn:** README, `docs/PROGRESS.md`, `plan.yml` (đã lỗi thời), và code.
- **Không đọc code khi viết baseline.** Entry point chỉ ghi khi đặc tả nêu rõ (API, menu, URL Admin). Không có thì ghi `cxđ` (chưa xác định); việc này để Phase 3 đối chiếu với graph.
- **Ký hiệu cột:**
  - **Quyền:** `KH` khách, `CQ` chủ quán, `SP` shipper (DRIVER), `AD` ADMIN theo scope, `SYS` SYSTEM.
  - **Nguồn:** tên file `docs/current` không có đuôi `.md`, `#NNN` là issue/PR, `G0x` là handoff, kèm ngày quyết định.
  - **`[P8]`:** dòng có lỗi đã biết (#294, #295) cần đối chiếu và sửa ở Phase 8 bằng test red→green. Phase 1 **không** sửa.
  - **`→ C-xx`:** liên kết truy vết xung đột nguồn đã được Owner chốt ở mục 16 (không còn là blocker quyết định nghiệp vụ).
- **M09 đã gộp vào M02.** Không đánh lại số module.

## 1. M00 — Nền tảng, hợp đồng chung

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M00-R-01 | M00 | API có version | `/v1/*` | JSON snake_case, ID chuỗi bất biến, tiền nguyên VND, khoảng cách bằng mét gốc, thời gian ISO 8601 UTC, UI hiển thị giờ Việt Nam | — | — | Thay đổi phá vỡ phải có kế hoạch chuyển đổi | buoc-4.1 (§6) |
| M00-R-02 | M00 | Mọi mutation có Idempotency-Key | Mọi POST/PATCH/PUT/DELETE | Cùng key cùng body trả lại kết quả cũ; quyền hiện hành được kiểm trước khi replay thao tác nhạy cảm | `idempotency_records` (actor/operation/key unique, request hash) | Theo endpoint | Cùng key khác body → 409 | buoc-4.1 §4, §6; ADR-003 |
| M00-R-03 | M00 | Command đổi trạng thái dùng `expected_version` | Command trạng thái | Chỉ một chuyển trạng thái hợp lệ thắng | `resource_version` tăng theo từng resource | — | Lệch version → 409 | buoc-4.1 §2, §6 |
| M00-R-04 | M00 | Hợp đồng lỗi chuẩn | Mọi API | Lỗi gồm code/message/request_id/details đã whitelist; dùng 401/403/404/409/422/429/503 | — | — | Không lộ chi tiết nội bộ | buoc-4.1 §6 |
| M00-R-05 | M00 | Không thay giá trị "chưa biết" bằng 0 | Mọi API và UI | Phí, khoảng cách, số liệu chưa biết hiển thị là chưa xác định | — | — | Lỗi tải không hiện thành 0 | buoc-4.1 §6; M12-spec §2 |
| M00-R-06 | M00 | Outbox ghi cùng transaction nghiệp vụ | cxđ | Event envelope có event_id, event_type, schema_version, resource_type/id/version, occurred_at | `outbox_events` | — | Lỗi ghi phần nào thì rollback tất cả | buoc-4.1 §4, §6; ADR-003 |
| M00-R-07 | M00 | Audit không chứa bí mật | cxđ | Ghi actor, thời điểm, lý do, trước/sau | `audit_logs` append-only | — | — | buoc-4.1 §4; M11 §8 |
| M00-R-08 | M00 | Thao tác liên module chạy trong một transaction | cxđ | Các service nhận transaction context chung; không ghép nhiều HTTP call rồi giả nguyên tử. Routing provider gọi ngoài transaction, lúc commit kiểm lại tuổi kết quả | — | — | Rollback toàn bộ | buoc-4.1 §7; ADR-003 |
| M00-R-09 | M00 | Migration chỉ thêm, không sửa tại chỗ | `database/migrations` | Migration đã dùng không sửa; đổi bảng phải đi cùng grant runtime | — | — | Thiếu grant không được gây 500 | buoc-4.1 §2; shared-address-picker (20/10); M10-M07-filter §2.1 |
| M00-R-10 | M00 | Môi trường tách biệt | — | Dev/staging/production có dữ liệu và secret riêng; OTP/map giả chỉ chạy ở môi trường test được gắn cờ | — | — | — | buoc-4.1 §3 |

## 2. M01 — Tài khoản, xác thực, phiên

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M01-R-01 | M01 | Vai trò và hai phạm vi định danh | — | Vai trò SYSTEM, ADMIN, CUSTOMER, SHOP_OWNER, DRIVER (UI gọi là "shipper"). Scope ADMIN_WEB và APP_USER tách biệt | SĐT unique theo scope | — | — | M01-final-package (14/10); ADR-002 |
| M01-R-02 | M01 | Đăng ký app có OTP (bật/tắt được) | Màn đăng ký 11Food/11Ship; API cxđ | OTP bật (mặc định): xác minh SĐT. OTP tắt: tạo tài khoản PHONE_UNVERIFIED | Cờ OTP đăng ký | Công tắc chỉ SYS | — | M01-otp-policy (24/10) |
| M01-R-03 | M01 | Quên mật khẩu bằng OTP (bật/tắt được) | 3 endpoint reset; API cxđ | Bật: reset qua OTP. Tắt: cả 3 endpoint trả 403 PASSWORD_RESET_DISABLED. Khôi phục tài khoản luôn cần OTP | Cờ OTP reset | Công tắc chỉ SYS | 403 PASSWORD_RESET_DISABLED | M01-otp-policy (24/10) |
| M01-R-04 | M01 | Chính sách OTP | — | Mặc định: cooldown 60 s; sai tối đa 3 lần; 3/giờ; 5/ngày; 10/IP/giờ; 30/gateway/ngày | Cấu hình OTP | SYS sửa | Vượt hạn mức → 429 | M01-otp-policy; M12-implementation (OTP 3 lần) |
| M01-R-05 | M01 | Kiểm tra SĐT Việt Nam | Form đăng ký/đăng nhập | 0 + 9 số, hoặc 84/+84 + 9 số, không có khoảng trắng bên trong; kiểm đầu số di động VN, chấp nhận 075 và 095 | — | — | Lỗi hiện dưới đúng ô | shared-address-picker (19–20/10); Owner 25/10 |
| M01-R-06 | M01 | Mật khẩu | Đăng ký, đổi mật khẩu | 8–128 ký tự, nhập lại phải khớp; lưu bằng Argon2id | — | — | Lỗi dưới ô | M01-password-sessions (23/10); ADR-002 |
| M01-R-07 | M01 | Phiên đăng nhập | Đăng nhập | Token opaque, lưu SHA-256, hết hạn tuyệt đối 7 ngày. Đăng nhập bằng mật khẩu thu hồi các phiên trước (một phiên hoạt động) | `sessions` | — | Phiên hết hạn/thu hồi → 401 | M01-password-sessions (23/10) |
| M01-R-08 | M01 | Giới hạn đăng nhập | Đăng nhập | Tối đa 30 lần/phút/SĐT | — | — | 429 | M01-password-sessions |
| M01-R-09 | M01 | Đăng nhập Admin Web | Admin Web | Chỉ tài khoản scope ADMIN_WEB, có 2FA | — | AD, SYS | — | M01-final-package; ADR-002 |
| M01-R-10 | M01 | Quên mật khẩu Admin qua SMS | PWA Admin | Chỉ dành cho ADMIN, không dành cho SYSTEM | — | AD | — | #235 |
| M01-R-11 | M01 | Xóa tài khoản → C-20 | Admin: `POST /v1/admin/users/:id/delete`; lối người dùng tự xóa trên app: cxđ | Áp cho CUSTOMER/SHOP_OWNER/DRIVER, không áp SYSTEM. Không có dữ liệu liên quan: xóa vĩnh viễn. Có dữ liệu liên quan: không xóa, chuyển khóa với lý do DELETE_REQUEST | Giữ audit, outbox, OTP/proof, idempotency | Nguồn hiện chỉ có Admin thực hiện; người dùng tự xóa chưa được chốt (C-20) | Còn việc đang chạy → chặn | M01-final-package (14/10); #251 (28/10) |
| M01-R-12 | M01 | Khóa/xóa an toàn | Admin khóa/xóa | Kiểm việc đang chạy qua adapter thật của M10, M07, M04, M11. Tách activeWork (chặn) khỏi relatedData (chọn purge hay khóa). Chống race TOCTOU | — | AD (can_lock) | Còn việc → lỗi rõ, không khóa | #251 (28/10) |
| M01-R-13 | M01 | Tài khoản tạo khi tắt OTP | — | Chỉ tài khoản được tạo khi SYSTEM tắt xác minh OTP đăng ký mới ở PHONE_UNVERIFIED; không mở rộng thành "mọi tài khoản test" | PHONE_UNVERIFIED | — | — | M01-otp-policy (24/10); #251 (28/10) |
| M01-R-14 | M01 | Điều khoản và quyền riêng tư | Đăng ký | Bản hiện hành: terms-20261014-v1, privacy-20261017-v1. Bản nháp v2 (31/10) chưa được duyệt → C-13 | Phiên bản đồng ý lưu theo user | — | — | M01-terms-privacy (14/10, 17/10); M01-terms-privacy-draft (31/10) |
| M01-R-15 | M01 | Đăng xuất có hiệu lực ngay `[P8]` | Tài khoản → Đăng xuất (11Ship, 11Food) | UI chuyển ngay sang trạng thái khách/chưa đăng nhập; dừng mọi luồng riêng của phiên (push, GPS, long-poll). Máy chủ vẫn là bên quyết định | Session bị thu hồi | — | Response đến muộn của phiên cũ bị bỏ qua | #295 (01/11); M08 §9; M14-online-location |
| M01-R-16 | M01 | Đổi tài khoản không lộ dữ liệu `[P8]` | Đăng xuất A → đăng nhập B | B không bao giờ thấy dữ liệu của A (ví, đơn, thông báo), kể cả khi response của A về muộn | Cache theo tài khoản | — | Bỏ dữ liệu không thuộc phiên hiện tại | #295; M08 §9 |
| M01-R-17 | M01 | Mời và kích hoạt ADMIN | Admin Web: tạo/xem lời mời → mở link → kích hoạt | SYSTEM tạo lời mời có quyền; người được mời mở link, xác minh OTP qua SMS (purpose ADMIN_ACTIVATION riêng) rồi kích hoạt. Trang kích hoạt chỉ mở ô nhập mã khi gateway đã gửi SMS | Lời mời, challenge kích hoạt | SYS tạo lời mời | Gateway chưa sẵn sàng → báo đúng, không giả đã gửi | M01-workstreams (12/10); M01-production-profile (14/10) |
| M01-R-18 | M01 | SMS Gateway là kênh OTP duy nhất | Mọi luồng OTP | OTP chỉ đi qua SMS Gateway (`SMS_GATEWAY_ENABLED=true`); không có chế độ DISABLED_TEST/FAKE/TEST_INBOX/fixture trên VPS | Hàng đợi SMS | — | Gateway chưa sẵn sàng → lỗi trung thực, không bỏ qua OTP | M01-production-profile (14/10); #101; #103 |
| M01-R-19 | M01 | Ràng buộc thiết bị theo phiên | cxđ | Phiên app gắn với thiết bị; xóa tài khoản vĩnh viễn thì xóa phiên, ràng buộc thiết bị và khóa thiết bị không còn liên kết. Nguồn chỉ nêu gián tiếp; chi tiết hành vi cần Codex/Owner xác nhận | Ràng buộc/khóa thiết bị | — | — | M01-final-package (14/10); M08 §9 |
| M01-R-20 | M01 | Khôi phục tài khoản | Luồng khôi phục | Chỉ khôi phục tài khoản bị khóa với lý do DELETE_REQUEST; luôn cần OTP; giữ nguyên user_id, vai trò, dữ liệu; không tự kích hoạt lại | — | Chủ tài khoản | Lý do khóa khác → không khôi phục qua luồng này | M01-final-package (14/10); #251 (28/10) |
| M01-R-21 | M01 | Bản ghi đồng ý điều khoản bất biến | Đăng ký | Mỗi lần đồng ý lưu phiên bản, thời điểm; không sửa; chỉ bản được Owner duyệt mới dùng | Consent | — | — | M01-final-package; M01-terms-privacy (14/10, 17/10) |
| M01-R-22 | M01 | Giới hạn năng lực khi PHONE_UNVERIFIED | Mọi thao tác cần SĐT đã xác minh | Tài khoản PHONE_UNVERIFIED chỉ được dùng các chức năng đã cho phép; thao tác cần SĐT xác minh bị chặn rõ ràng | — | — | Chặn với mã lỗi rõ | M01-otp-policy (24/10); #251 (28/10) |

## 3. M02 — Quán, thực đơn, khám phá (gồm M09 cũ)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M02-R-01 | M02 | Thiết lập quán 4 bước | 11Food (CQ) | Bước 1 tài khoản; bước 2 hồ sơ + giờ mở cửa; bước 3 ghim điểm lấy hàng; bước 4 có ít nhất 1 món VISIBLE giá > 0. Đủ 4 bước thì tự kích hoạt | Trạng thái setup | CQ | Thiếu bước nào thì báo đúng bước đó | issue-190-shop-setup (25/10); #190 |
| M02-R-02 | M02 | Một cổng chặn thống nhất | Mọi API công khai về quán | ShopSetupGate là cổng duy nhất quyết định quán có hiện công khai hay không | — | — | Quán chưa đủ điều kiện không xuất hiện | #190 |
| M02-R-03 | M02 | Ghim quán trên bản đồ → C-16 | Bước 3 setup | Ghim trên bản đồ, không bắt buộc có GPS. Ghim phải nằm trong khu vực phục vụ. Hoàn thành lại đủ 4 bước thì xóa NEEDS_REVIEW | Tọa độ quán | CQ | Ngoài khu vực → từ chối, báo rõ. Khu vực ACTIVE thiếu geometry: xem C-16 | #252 (28/10) |
| M02-R-04 | M02 | Quản lý khu vực phục vụ | Admin Web | Tạo/sửa/ngừng khu vực phục vụ; xem trước tác động trước khi lưu; không xóa cứng; không tự chuyển quán sang khu vực khác | `service_areas`; version, idempotency, audit, outbox | Chỉ SYS | — | #253 (28/10); G14 |
| M02-R-05 | M02 | Giờ mở cửa theo lịch | Cài đặt quán | Mở/đóng chỉ theo lịch, không có công tắc tay. Giờ đóng là exclusive, múi giờ Asia/Ho_Chi_Minh. App tự làm mới ở ranh giới mở/đóng kế tiếp và khi quay lại app | Lịch tuần | CQ | — | M02-workstreams; #204 |
| M02-R-06 | M02 | Chọn giờ bằng dropdown | Cài đặt giờ | Chọn giờ bằng dropdown | — | CQ | — | M02-shop-logo-time-dropdown (20/10) |
| M02-R-07 | M02 | Logo quán | Hồ sơ quán | Logo tùy chọn, tối đa 1 MiB | — | CQ | Quá cỡ → lỗi rõ | M02-shop-logo-time-dropdown (20/10) |
| M02-R-08 | M02 | Liên kết liên hệ | Hồ sơ quán | Chỉ chấp nhận https. Zalo/Facebook không bắt buộc, giới hạn 160/300 ký tự | — | CQ | Lỗi dưới ô | #190; shared-address-picker |
| M02-R-09 | M02 | Món ăn | Thực đơn (CQ) | Mô tả tùy chọn, tối đa 300 ký tự. Ảnh tùy chọn. Cắt ảnh WYSIWYG | Món: VISIBLE/ẩn/xóa | CQ | — | #207; #209; #245 |
| M02-R-10 | M02 | Giới hạn số món hiển thị | Thực đơn | Mặc định 20 món VISIBLE; tăng bằng entitlement riêng (M04-R-11) | Entitlement | CQ; AD (`shop.entitlement.manage`) | Vượt giới hạn → chặn, báo rõ | G03 (26/10) |
| M02-R-11 | M02 | Tìm quán/món | 11Food Home/Tìm kiếm | Tìm không dấu, có bộ lọc; Home có khối "Quán gần bạn" | — | KH | — | M02-discovery-UI-LOCKED (16/10); M02-home-shop-detail-UI-OWNER (22/10) |
| M02-R-12 | M02 | Khoảng cách trên Home/Tìm kiếm/Chi tiết quán `[P8]` → C-05 | 11Food Home, Tìm kiếm, Chi tiết quán | Luôn là quãng đường **từ quán → GPS hiện tại của khách**, theo hợp đồng M14 (M14-R-10), ghi nhãn rõ ý nghĩa. Không có GPS thì hiện "chưa xác định". Không dùng đường thẳng | Cache khoảng cách | KH | Đổi GPS → bỏ cache; lỗi tuyến → "chưa xác định" | #294 (01/11); #206 |
| M02-R-13 | M02 | Admin quản lý quán | Admin Web › Quán | Xem/khóa/tắt quán theo quyền | — | AD (`can_manage_shops`) | Còn việc mở → SHOP_HAS_OPEN_WORK | M02-admin-shops (24/10) |
| M02-R-14 | M02 | Banner trạng thái không lỗi thời | 11Food (CQ) | Banner trạng thái quán khớp dữ liệu máy chủ | — | CQ | — | #281 |
| M02-R-15 | M02 | Nhóm món hệ thống | 11Food Home (chip nhóm món), Chi tiết quán; quản trị cxđ | Khám phá lọc theo nhóm món hệ thống đang hoạt động; thực đơn quán hiển thị theo nhóm. Không xóa vật lý nhóm, không tự chuyển món sang nhóm khác | Nhóm món | KH xem; quản trị cxđ | — | M02-discovery-UI-LOCKED (16/10); M02-home-shop-detail-UI-OWNER (22/10) |
| M02-R-16 | M02 | Đổi ghim quán chỉ áp đơn mới | Bước 3 setup | Ghim mới chỉ áp cho đơn tạo sau đó; snapshot đơn cũ giữ nguyên | Snapshot Order/Delivery | CQ | — | #252 (28/10) |
| M02-R-17 | M02 | Khu vực thiếu geometry → C-16 | — | BLOCKED: chờ Owner chốt cách xử lý khu vực ACTIVE chưa có hình học | — | — | — | #252 (28/10); G14 |

## 4. M03 — Shipper

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M03-R-01 | M03 | Đăng ký shipper đơn giản | Đăng ký 11Ship | Tạo DRIVER ở trạng thái ACTIVE kèm ví 0 đ. Không cần khu vực, ngân hàng hay duyệt hồ sơ | `drivers`, ví | SP | — | M03-simplified-onboarding (20/10) → C-02, C-04 |
| M03-R-02 | M03 | Ngưỡng nạp ban đầu | Nhận đơn | Phải nạp đủ ngưỡng ban đầu mới được nhận đơn | Cấu hình ngưỡng | SYS cấu hình | Chưa đủ → không nhận đơn, báo lý do | M03-simplified-onboarding |
| M03-R-03 | M03 | Sửa tên shipper → C-18 | Hồ sơ 11Ship | Shipper sửa được tên hiển thị. Khi đã có tài khoản ngân hàng hoặc yêu cầu rút tiền, chính sách đổi tên/người thụ hưởng chưa chốt (C-18) | — | SP | — | #255 (28/10) |
| M03-R-04 | M03 | Đóng tài khoản (CLOSING) | Hồ sơ → Đóng tài khoản | Shipper (kể cả SUSPENDED, không cần mở khóa) yêu cầu vào CLOSING rồi xử lý nghĩa vụ còn lại. Việc đang chạy chặn hoàn tiền/hoàn tất, không mặc nhiên chặn yêu cầu đóng. Hủy/từ chối thì quay về trạng thái trước | ACTIVE/SUSPENDED → CLOSING → CLOSED | SP; AD duyệt | Hoàn tất khi còn việc → DRIVER_HAS_ACTIVE_WORK; ví chưa về 0 → DRIVER_WALLET_NOT_SETTLED | #255 (28/10) |
| M03-R-05 | M03 | Rút tiền chỉ khi đóng tài khoản | Ví (CLOSING) | Chỉ rút được khi CLOSING, rút toàn bộ số dư, không có mức tối thiểu. Rút là một hold; PAID ghi đúng một WITHDRAWAL_DEBIT | Hold rút tiền | SP; AD xử lý | — | #255 → C-01, C-02 |
| M03-R-06 | M03 | Điều kiện CLOSED | Admin | Chỉ CLOSED khi không còn: assignment, sự cố, tài chính chờ xử lý, yêu cầu nạp, yêu cầu rút đang mở/đang đối soát; số dư và hold về 0 | — | AD | Còn mục nào → chặn, nêu mục đó | #255 (28/10) |
| M03-R-07 | M03 | Online = chia sẻ vị trí (một nút) | Công tắc Online (Home, hồ sơ) | Bật online tự bật chia sẻ vị trí. Chỉ bật được khi máy chủ đã nhận vị trí hợp lệ còn mới | `intent_online` | SP | Chưa có vị trí → 409 DRIVER_LOCATION_NOT_READY | M14-online-location (24/10); `POST /driver/me/accepting` |
| M03-R-08 | M03 | Tắt online luôn được | Công tắc Online | Tắt luôn được, ngừng nhận đơn mới ngay, dừng GPS kể cả khi còn chuyến. Chuyến, phí, hoa hồng, hàng đang giữ không bị đụng | — | SP | — | #265 (29/10); M14-online-location (cập nhật 29/10) |
| M03-R-09 | M03 | Giữ lý do đình chỉ qua CLOSING | — | Lý do SUSPENDED và audit được giữ khi vào/ra CLOSING | Lý do khóa | — | — | #255 (28/10) |
| M03-R-10 | M03 | Xác minh người thụ hưởng khi hoàn tiền → C-18 | Admin xử lý rút | Admin xác minh người thụ hưởng trước khi trả tiền; snapshot thông tin ngân hàng tại thời điểm rút | Snapshot thụ hưởng | AD | Không khớp → không trả | #255 (28/10); C-02 |

## 5. M04 — Ví shipper, nạp/rút, thanh toán quán

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M04-R-01 | M04 | Bất biến ví | — | 0 ≤ held ≤ balance; balance = SUM(ledger); held = SUM(active holds). Một ví mỗi shipper | `driver_wallets`, `wallet_ledger_entries`, `wallet_holds` | — | Vi phạm → rollback | ADR-004; M04-A1 (17/10) |
| M04-R-02 | M04 | Ledger chỉ ghi thêm | — | Không sửa/xóa bút toán; điều chỉnh bằng bút toán mới | append-only | — | — | ADR-004; M04-A1 |
| M04-R-03 | M04 | Hold một lần | M07 nhận/giao/hủy | Hold active → captured hoặc released đúng một lần | Hold active/captured/released | — | Lặp → idempotent | M04-A2-1 (17/10); buoc-4.1 §5 |
| M04-R-04 | M04 | Yêu cầu nạp tiền | 11Ship Ví → Nạp | Vòng đời PENDING → CONFIRMED / REJECTED / CANCELLED | `wallet_topups` | SP | — | M04-B2-1 (18/10) |
| M04-R-05 | M04 | Chỉ Admin ghi có ví | Admin Web › Tài chính | Chỉ Admin xác nhận với số tiền thực nhận mới cộng vào ví. Mã giao dịch ngân hàng là duy nhất | — | AD (`wallet.topup.record`) | Trùng mã giao dịch → từ chối | M04-B2-2b (18/10) |
| M04-R-06 | M04 | Tài khoản nhận tiền | Admin cấu hình | Tài khoản có can_receive=false thì đóng (fail-closed) | — | SYS | Không hiện tài khoản không nhận | M04-B1; M04-B2-2a |
| M04-R-07 | M04 | Nạp khi CLOSING | Ví (CLOSING) | Không tạo yêu cầu nạp mới. Tiền chuyển đến muộn vẫn được đối soát (M04-R-14). Yêu cầu-trước/mã chuyển khoản duy nhất chỉ là đề xuất P2; QR/upload chứng từ chưa duyệt | — | SP; AD | Tạo mới → chặn | #256 (28/10) |
| M04-R-08 | M04 | Điều chỉnh khi thiếu số dư | M11 kết luận → M04 | Thiếu số dư thì ghi PENDING_FINANCE, không âm ví, không đụng tiền đang giữ. Thử lại dùng cùng adjustment_id | `wallet_adjustments` | AD (`wallet.adjustment.post`) | — | #219; M11 §7 |
| M04-R-09 | M04 | Quyền tài chính Admin | Admin Web | Quyền tách riêng: wallet.read, wallet.topup.record, wallet.adjustment.post | — | SYS cấp | Thiếu quyền → 403 | G03 (26/10); #262 |
| M04-R-10 | M04 | Thanh toán phí quán | Admin Web › Quán › Thanh toán | Không có gói thuê bao, không có ví quán. Quán báo đã chuyển khoản không tự cấp quyền gì | `shop_payments` | AD (`shop.payment.read/record`) → C-06 | — | G03 (26/10); #198 |
| M04-R-11 | M04 | Entitlement quán | Admin Web | Cấp entitlement là thao tác riêng, tách khỏi ghi nhận thanh toán | — | AD (`shop.entitlement.manage`) | — | G03; #198 |
| M04-R-12 | M04 | Chat tài chính quán | Quán ↔ Admin | Tin tối đa 500 grapheme; chat không phải thao tác tài chính | — | CQ; AD | Quá dài → từ chối | G03; #199 → C-09 |
| M04-R-13 | M04 | Ví chỉ hiện khi đã đăng nhập `[P8]` | 11Ship Tài khoản, Thu nhập, Home, deep link, thông báo | Mục "Ví của tôi" và mọi lối vào ví bị ẩn khi là khách, đã đăng xuất, phiên hết hạn/bị thu hồi, chưa xác minh hoặc đang khởi động. Chỉ hiện khi đã đăng nhập. Giữ hành vi lockedWalletOnly | — | SP | Deep link vào ví khi chưa đăng nhập → về màn đăng nhập | #295 (01/11) |
| M04-R-14 | M04 | Tiền đến muộn hoặc không có yêu cầu | Admin Web › Tài chính | Tiền đến khi không có yêu cầu, đến muộn hoặc sau CLOSED phải đi qua quy trình chứng từ + audit; không tự cộng ví, không gán nhầm | — | AD | Không xác định được chủ → giữ chờ xử lý | #256 (28/10) |

## 6. M05 — Hồ sơ khách và sổ địa chỉ

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M05-R-01 | M05 | Hồ sơ khách | `GET /v1/customers/me` | Mỗi user tối đa một hồ sơ khách, tạo khi cần, không cần OTP lại | `customers` (user_id unique) | KH | — | M05-design-approved (15/10) |
| M05-R-02 | M05 | Sổ địa chỉ nhiều mục | `GET/POST /v1/customers/me/addresses`, `PATCH/DELETE .../{id}` | Nhãn Nhà/Cơ quan/Khác; SĐT liên hệ và mô tả địa chỉ bắt buộc; ghim GPS tùy chọn (lat/lng cùng null hoặc cùng hợp lệ) | `customer_addresses` | KH (sở hữu theo phiên) | ID không thuộc mình → không truy cập được | M05-design-approved |
| M05-R-03 | M05 | Một địa chỉ mặc định | `PUT .../{id}/default` | Địa chỉ đầu tiên tự làm mặc định; tối đa 1 mặc định active; đổi nguyên tử | — | KH | Race → chỉ một thắng | M05-design-approved |
| M05-R-04 | M05 | Xóa mềm | `DELETE .../{id}` | Xóa sau xác nhận; xóa mặc định thì chọn địa chỉ active cập nhật gần nhất | is_active | KH | — | M05-design-approved |
| M05-R-05 | M05 | Snapshot đơn bất biến | — | Sửa/xóa địa chỉ không đổi snapshot của đơn cũ | Snapshot Order | — | — | M05-design-approved; M10 §13 |
| M05-R-06 | M05 | Bộ chọn địa chỉ dùng chung | Checkout, sổ địa chỉ, setup quán | Lưu cùng lúc chữ và điểm ghim; Quay lại không áp dụng sửa đổi; lỗi GPS không làm mất ghim cũ; không tạo tọa độ giả từ địa chỉ chữ | — | KH, CQ | — | shared-address-picker (19/10) |

## 7. M06 — Phí ship, điều kiện nhận và ghép đơn

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M06-R-01 | M06 | Bán kính tìm shipper 3 km | Danh sách đơn shipper | Đường thẳng (Haversine) từ GPS shipper; đúng 3.000 m tính là bên trong. Tài khoản PLATFORM được miễn bán kính | SHIPPER_SEARCH_RADIUS_M = 3000 | — | — | M06-v1.1 (18/10); #294 → C-03 |
| M06-R-02 | M06 | Ba khung phí | Quote phí | Đúng 3 khung [0,b1), [b1,b2), [b2,b3], dựa trên quãng đường từ M14, tính từ mét chưa làm tròn | Policy version | SYS cấu hình | — | M06-v1.1; #294 |
| M06-R-03 | M06 | Ngoài khung/không có tuyến | Quote phí | Trên b3 → OUT_OF_PRICE_RANGE. Không có tuyến → ROUTE_DATA_UNAVAILABLE. Phí là null, không bao giờ 0. Không seed giá | — | — | Hiện lý do cụ thể (M10-R-17) | M06-v1.1; #211 |
| M06-R-04 | M06 | Thỏa thuận phí | Tạo yêu cầu giao | STANDARD hoặc AGREED. Bên trả phí phải đồng ý. Khóa phí lúc pickup | Snapshot phí | Bên trả phí | — | M06-v1.1 |
| M06-R-05 | M06 | Tiền tip | Thỏa thuận phí | Tip cộng vào phí thỏa thuận, không thêm trường DB | — | — | — | #205 |
| M06-R-06 | M06 | Giới hạn shipper EXTERNAL | Nhận đơn | Tối đa 3 chuyến đang chạy | — | — | Vượt → không nhận | M06-BC (17/10) |
| M06-R-07 | M06 | Ghép đơn | Nhận đơn ghép | Trễ cộng dồn tối đa 300 s; matrix tối đa 20 chặng | — | — | — | M06-BC |
| M06-R-08 | M06 | Điều kiện nhận không cần ngân hàng | Kiểm điều kiện | Xác minh ngân hàng **không** còn là điều kiện nhận đơn | — | — | — | #257; M03-simplified → C-04 |
| M06-R-09 | M06 | Bỏ màn M06 giả/trùng | 11Ship | Bỏ các màn M06 giả hoặc trùng nhau (xem M06-R-11 về sàng lọc trước khác kiểm tra ghép) | — | SP | — | #257 (28/10) |
| M06-R-10 | M06 | Vị trí quá hạn | Danh sách/nhận đơn | Quá 120 s: ẩn danh sách (LOCATION_STALE), từ chối nhận DELIVERY_NOT_ELIGIBLE (kiểm lại trong transaction), bỏ qua khi phân phối | — | — | — | M14-online-location (24/10) |
| M06-R-11 | M06 | Sàng lọc trước không hứa nhận được | Danh sách đơn → Nhận | Sàng lọc trước chỉ để hiển thị; lúc nhận phải kiểm lại trong transaction | — | SP | Kiểm lại thất bại → không tạo hold/assignment | #257 (28/10) |
| M06-R-12 | M06 | Matrix tuyến fail-closed | Ghép đơn | Tối đa 20 chặng, có TTL; không bịa ETA, không cắt bớt điểm, không nới giới hạn | — | — | Vượt/hết hạn → từ chối | #257 (28/10) |

## 8. M07 — Giao hàng (delivery, assignment)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M07-R-01 | M07 | Không có bước "món sẵn sàng" riêng | 11Food (CQ) | Bỏ bước "ready". Bấm "Gọi shipper" nghĩa là món đã sẵn sàng | — | CQ | — | M07-owner-delivery-flow (23/10) → C-10 |
| M07-R-02 | M07 | Shipper nhả đơn trước pickup | 11Ship | Trước pickup shipper được nhả đơn; tìm lại theo hạn còn lại, không reset hạn | Assignment | SP | — | M07-owner-delivery-flow; M08 §4 |
| M07-R-03 | M07 | Sau pickup chỉ có "Giao thành công" | 11Ship | Sau pickup không có nút thất bại hay nhả đơn | DELIVERED | SP | — | M07-owner-delivery-flow (23/10) |
| M07-R-04 | M07 | Hủy sau pickup | 11Food | Chỉ **người tạo yêu cầu** được hủy: ORDER → khách đặt; Gọi shipper độc lập mới → khách tạo; DIRECT cũ do quán tạo → quán tạo. Không tự hủy sau pickup | Người tạo/nguồn yêu cầu | KH; CQ chỉ với DIRECT cũ hợp lệ | Không cho shipper tự mở quyền hủy sau pickup | M07-owner-delivery-flow (23/10); #221 (Owner 26/10) → C-11 |
| M07-R-05 | M07 | DIRECT/đơn giao không gắn đặt món | 11Food (KH) → Gọi shipper | Không còn **lối tạo DIRECT độc lập trong chế độ quán**. Người gửi, kể cả chủ quán gửi hàng ngoài app, tạo yêu cầu ở chế độ Khách hàng; không bắt buộc quán/giỏ/món/giá trị hàng; GPS cả hai điểm tùy chọn, tracking chỉ khi đủ hai tọa độ; thiếu GPS vẫn tạo/nhận/hoàn thành và dùng phí thỏa thuận khi không định tuyến được. DIRECT cũ vẫn đọc/xử lý/lưu lịch sử | Delivery theo creator; tương thích bản ghi DIRECT cũ | KH tạo; CQ chỉ quản lý DIRECT cũ theo quyền | Không dùng (0,0), GPS giả hay giả 0 km/0đ | #221 (Owner 26/10); #282 (30/10) → C-11 |
| M07-R-06 | M07 | Thương lượng lại phí | Đề nghị phí mới | Bên trả phí quyết định. Hết hạn trả lời mặc định 5 phút, SYSTEM cấu hình được | — | Bên trả phí; SYS | Hết hạn → giữ phí cũ | M07-owner-delivery-flow (bổ sung 24/10) |
| M07-R-07 | M07 | Không liên lạc được khách | 11Ship | Shipper gọi cho quán; app không can thiệp | — | SP | — | #258 (28/10) |
| M07-R-08 | M07 | Shipper bị SUSPENDED (xem M07-R-16) | — | Giữ assignment đang có với quyền tối thiểu để xử lý việc cũ; không nhận việc mới | — | SP | — | #258 (28/10) |
| M07-R-09 | M07 | Admin "Chuyển M11" → C-17 | Admin Web › Giao hàng | Kết quả phải trung thực: hồ sơ M11 thật hoặc chỉ "đánh dấu cần theo dõi" và đổi nhãn tương ứng; không tạo ticket giả, không mạo danh người phản ánh; có audit. BLOCKED: Owner chưa chọn phương án | — | AD | — | #258 (28/10) |
| M07-R-10 | M07 | Không có nút Bỏ qua | 11Ship danh sách đơn | Không có nút Skip | — | SP | — | #212 |
| M07-R-11 | M07 | Khách Gọi shipper | 11Food chế độ KH, tab Gọi ship | Thu hộ là thông tin, không ledger/ứng tiền bắt buộc; người gửi/nhận có thể trả phí theo lựa chọn; GPS tùy chọn, tracking khi đủ hai điểm GPS; người tạo có thể chia sẻ link theo dõi giới hạn và thu hồi; đơn hoàn thành theo lifecycle, không chờ đối soát thu hộ | Yêu cầu giao do KH tạo, tiền thu hộ tách phí giao | KH; SP đúng assignment | Không có route → phí chưa xác định/thỏa thuận; không giả tracking | #221 (Owner 26/10); #282 (30/10) → C-11 |
| M07-R-12 | M07 | Trợ giúp trong đơn | Chi tiết đơn | Có lối trợ giúp ngay trong đơn | — | KH, CQ, SP | — | #217 |
| M07-R-13 | M07 | Hạn tìm shipper | — | Nhắc 5 và 15 phút; ngừng tìm ở phút 30. Hủy nhận giữ mốc cũ; gọi lại tạo delivery mới với mốc mới | Mốc lưu DB | — | Restart không reset | M08 §5; M10-timeouts |
| M07-R-14 | M07 | Ba hành động hủy khác nhau | 11Food, 11Ship | Hủy đơn món / Hủy yêu cầu giao / Shipper hủy nhận là ba nút khác nhau, không dùng nút "Hủy" mơ hồ | — | Theo M10-R-10 | Race hủy vs pickup → một bên thắng | M10 §9 |
| M07-R-15 | M07 | Quãng đường cố định suốt vòng đời đơn `[P8]` | Delivery | Dùng cùng `distance_m` đã báo giá cho delivery, phí và hiển thị; tuyến vẽ là tuyến đã báo giá | `route_distance_m` | — | — | #294 |
| M07-R-16 | M07 | Quyền với việc cũ khi SUSPENDED | 11Ship | Shipper SUSPENDED chỉ thấy/xử lý assignment đang có; chặn việc mới; kiểm phiên, race và không chéo sang delivery khác | — | SP | Thao tác ngoài phạm vi → 403 | #258 (28/10) |

## 9. M08 — Thông báo, nhắc việc, đồng bộ

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M08-R-01 | M08 | Ba kênh, một mục hộp thư | — | Cập nhật trực tiếp, push, hộp thông báo. Một sự kiện đi nhiều kênh vẫn chỉ có một mục hộp thư. Push không chứng minh thao tác thành công | `notification_deliveries` | — | — | M08-Functional-UI-LOCKED §2 (16/10) |
| M08-R-02 | M08 | Danh mục sự kiện và người nhận | — | Theo bảng §3 của spec (đơn mới, xác nhận, từ chối, nhận, pickup, kết quả, nạp/rút…). Người nhận nhập tay không tự thành người nhận thông báo | — | — | — | M08 §3 |
| M08-R-03 | M08 | Báo đơn mới cho shipper | Thẻ "Có đơn giao hàng mới" | Chỉ shipper đang bật nhận và đủ điều kiện. Không có SĐT/địa chỉ chi tiết trước khi nhận. Tối đa 1 push/shipper/delivery/đợt. Gom một thẻ | — | SP | Đơn hết khả dụng → "Đơn này không còn có thể nhận" | M08 §4 |
| M08-R-04 | M08 | Nhắc lấy hàng | — | Mỗi 5 phút từ lúc nhận; dừng khi pickup/hủy nhận/quán hủy | — | SP | Không phát dồn mốc cũ | M08 §5 |
| M08-R-05 | M08 | Hộp thông báo | Chuông đầu màn | Lọc Tất cả/Chưa đọc; nhóm Hôm nay/Hôm qua/Trước đó; đánh dấu đã đọc; chạm mở đúng đối tượng sau khi máy chủ kiểm lại quyền | — | Theo tài khoản | Mất quyền → "Bạn không còn quyền xem nội dung này" | M08 §6 |
| M08-R-06 | M08 | Cài đặt thông báo | Tài khoản → Cài đặt thông báo | Mặc định bật hết; tắt nhóm vẫn giữ mục hộp thư; tắt âm thanh không tắt nhận đơn; timer nghiệp vụ không chỉnh được | — | Chủ tài khoản | — | M08 §7 |
| M08-R-07 | M08 | Đồng bộ và chống trùng | `GET /v1/notifications/changes` | Mở lại/reconnect/chạm push đều đọc lại máy chủ; event cũ không đè version mới; retry không nhân đôi | — | — | Mất mạng → "Mất kết nối — dữ liệu có thể chưa cập nhật" | M08 §8; M08-implementation |
| M08-R-08 | M08 | Thiết bị, phiên, riêng tư | — | Push gắn phiên; đăng nhập máy mới thu hồi liên kết cũ; logout ngừng gửi riêng. Nội dung khóa màn hình không chứa OTP/mật khẩu/SĐT/địa chỉ/ngân hàng | Token push theo session | — | — | M08 §9 |
| M08-R-09 | M08 | Lưu trữ | — | Hộp thư 90 ngày, sau đó lưu trữ, xóa sau tổng 365 ngày. Sự kiện cũ hơn 24 giờ không phát | — | — | STALE_EVENT | M08 §11; M08-implementation |
| M08-R-10 | M08 | Admin Thông báo | Admin Web › Vận hành › Thông báo | Việc cần xử lý / Tra cứu / Cấu hình. Không có nút gửi, phát lại hay phát hàng loạt. Chỉ SYS sửa cấu hình | — | SYS; AD theo app được xem | — | M08 §10 |
| M08-R-11 | M08 | FCM hoãn; kết quả rút tiền trong hộp thư | Hộp thông báo 11Ship | Push thật hoãn tới khi chuẩn bị Google Play. Kết quả rút tiền đi vào hộp thư trong app (chi tiết M08-R-14); đọc được ở CLOSING/SUSPENDED/CLOSED, không phụ thuộc FCM | — | SP | Thiếu cấu hình → PROVIDER_NOT_CONFIGURED | Owner 18/10; #259 (29/10) |
| M08-R-12 | M08 | Counter Admin có scope | Admin Web | Bộ đếm việc cần xử lý chỉ đếm trong scope của ADMIN | — | AD | — | #259 |
| M08-R-13 | M08 | Chạm thông báo tự đổi vai trò | App | Chạm thông báo của vai trò khác thì app tự chuyển vai trò | — | — | — | #202 |
| M08-R-14 | M08 | Thông báo vòng đời rút tiền | Hộp thông báo 11Ship | Mỗi trạng thái rút tiền tạo đúng một thông báo; người nhận lấy từ DB; chống trùng, chịu được sự kiện đến sai thứ tự | — | SP | — | #259 (29/10) |
| M08-R-15 | M08 | Counter và danh sách Admin cùng scope | Admin Web | Counter, ca hàng (goods_cases), lỗi gửi và chi tiết dùng cùng một scope | — | AD | — | #259 (29/10) |

## 10. M10 — Đặt món và đơn hàng quán

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M10-R-01 | M10 | Giỏ hàng | 11Food thực đơn (nút +) | Một giỏ một quán; cùng món cùng ghi chú thì gộp; thêm món quán khác phải xác nhận thay giỏ; giữ giỏ khi thoát app nhưng giá trong giỏ không phải giá chốt | Giỏ trên máy | KH | — | M10-Functional-UI-LOCKED §2 (16/10) |
| M10-R-02 | M10 | Chưa có tính năng thanh toán mở rộng | — | Không topping/size/combo/voucher/ví khách/thanh toán online | — | — | — | M10 §2, §11 |
| M10-R-03 | M10 | Xác nhận đặt món | Checkout | Người nhận (tên/SĐT) bắt buộc, có thể khác người đặt; địa chỉ từ M05 hoặc nhập mới; tiền món và phí ship tách riêng | — | KH | Phí chưa có → ghi rõ, không hiện 0 đ | M10 §3 |
| M10-R-04 | M10 | Máy chủ kiểm trước khi tạo | Tạo Order | Kiểm quán hợp lệ, món còn hiện, giá hiện tại, lịch mở cửa/giờ hẹn, người nhận, địa chỉ | — | KH | Giá đổi/món ẩn → báo khách xác nhận lại | M10 §3 |
| M10-R-05 | M10 | Gửi đơn an toàn khi mất mạng | Tạo Order | Retry cùng thao tác không tạo hai Order; trạng thái chưa biết không báo thành công/thất bại chắc chắn | Idempotency | KH | — | M10 §4 |
| M10-R-06 | M10 | Khoảng cách ở checkout/đặt/sửa đơn `[P8]` | Checkout, đặt đơn, sửa đơn | Quãng đường **quán → điểm giao đã chọn** theo hợp đồng M14. Đổi địa chỉ thì quote cũ hết hiệu lực. Một hợp đồng quote duy nhất | Quote | KH | Không tuyến → lý do cụ thể | #294; #239 |
| M10-R-07 | M10 | Quán xác nhận/sửa đơn | 11Food (CQ) | Trước xác nhận được sửa số lượng, đơn giá, bỏ món; có thay đổi thì bắt buộc lý do; khách thấy bản ban đầu và bản chốt; không xác nhận đơn rỗng; xác nhận xong khóa món và tiền món | Snapshot | CQ | — | M10 §5 |
| M10-R-08 | M10 | Quán đặt giá cuối | 11Food (CQ) | Quán đặt giá cuối có lý do, không cần khách duyệt, hiển thị minh bạch | — | CQ | — | #260 (29/10) |
| M10-R-09 | M10 | Khách sửa đơn khi chờ xác nhận `[P8]` | 11Food chi tiết đơn → Sửa đơn | Chỉ khi PENDING_CONFIRMATION, có kiểm version; cho sửa món/người nhận/địa chỉ. **Bắt buộc** có chọn sổ địa chỉ hoặc địa chỉ khác, tìm địa điểm offline/chọn-điều chỉnh ghim trên bản đồ ngay trong luồng sửa; dùng picker chung, không ép lưu vào sổ. Đổi địa chỉ hủy preview cũ, tính lại km/phí và cho xem trước khi lưu; hiện còn gap UI theo Owner test 31/10 | expected_version; DraftAddress | KH | Lệch version → 409; thoát không lưu; tuyến thiếu → báo rõ | #238 (Owner 26/10, kiểm thử 31/10); #294 (01/11) |
| M10-R-10 | M10 | Quyền hủy | 11Food | Chưa xác nhận: khách hủy, quán từ chối (có lý do). Đã xác nhận chưa pickup: quán hủy có lý do. Đã pickup: theo M07-R-04 | — | KH, CQ | Race hủy vs xác nhận → một bên thắng | M10 §9; M07-owner-delivery-flow |
| M10-R-11 | M10 | Thời hạn ba giai đoạn | — | Chờ quán: nhắc phút 15/20/25, phút 30 SYSTEM hủy. Chờ shipper: ngừng tìm phút 30, phút 60 SYSTEM hủy cả Order. Đã nhận chưa lấy: phút 30 cảnh báo, phút 60 SYSTEM hủy và giải phóng hold. Không cộng dồn giai đoạn; pickup thắng thì không hủy | Policy snapshot lúc INSERT | — | Lỗi phần nào rollback tất cả | M10-timeouts (21/10); #153 |
| M10-R-12 | M10 | Cấu hình thời hạn | Admin `/system/settings/order-timeouts` | Bảy ô phút; lịch sử thay đổi append-only | `order_timeout_policy(_changes)` | SYS hoặc AD có quyền | — | M10-timeouts |
| M10-R-13 | M10 | Log mọi kiểu hủy | — | `cancellation_transitions` append-only; CANCELLED_BY_SYSTEM hiện rõ là hệ thống hủy; hủy bởi Admin hiện là Admin hủy | — | — | — | M10-timeouts; #260 |
| M10-R-14 | M10 | Trạng thái hiển thị | 11Food | Nhãn khách theo bảng §8 (Chờ quán xác nhận … Hoàn thành) | Order và delivery lưu riêng | KH | — | M10 §8 |
| M10-R-15 | M10 | Hiện Đã thanh toán / Còn phải thanh toán | Chi tiết đơn 11Food (KH/CQ), thẻ Tiền món và phí giao | Hiện Tiền món, Phí giao, Tổng dự kiến nếu đủ dữ liệu, **Đã thanh toán** và **Còn phải thanh toán**. Nếu paid_vnd/remaining_vnd chỉ phản ánh tiền món phải ghi rõ nhãn **tiền món**; chỉ tính số tổng gồm phí khi xác minh bên chịu phí, mức phí chốt và số đã trả; không trừ phí quán trả vào nợ khách, không số âm/0 giả. Chỉ ghi nhận tiền thực có nguồn và quyền/audit; giao xong không mặc định đã thu; thanh toán trực tiếp ngoài app, không mở ví khách/online | Tiền món đã ghi nhận, tiền món còn lại; phí giao/phạm vi thanh toán tách riêng | KH, CQ xem; thao tác ghi nhận theo quyền backend | Không đủ dữ liệu phí đã trả → hiển thị riêng từng khoản, không bịa tổng | #213 (Owner 26/10, thay M07 23/10); M10 §11 → C-08 |
| M10-R-16 | M10 | Đơn hẹn giờ | Checkout | Giờ hẹn là giờ mong muốn nhận món; chọn theo lịch quán; chưa tự gọi shipper theo đồng hồ | — | KH | — | M10 §7 |
| M10-R-17 | M10 | Lý do thiếu phí/khoảng cách | Checkout, chi tiết | Hiện lý do cụ thể khi thiếu khoảng cách/phí | — | KH | — | #211 |
| M10-R-18 | M10 | Xin đổi địa chỉ/người nhận sau khi tạo đơn | Chi tiết đơn | Có một đường xin đổi rõ ràng; người có quyền xác nhận trước khi thay snapshot. Trước lấy hàng: nếu ảnh hưởng tuyến/phí thì tính lại và xin người trả phí đồng ý, không có hai assignment hoạt động. Sau lấy: giữ khóa phí, không tự cho sửa điểm giao. Đơn kết thúc: không sửa | Snapshot trước/sau, người xác nhận, lý do, version | KH xin; quán/người trả phí xác nhận theo giai đoạn | Phản hồi muộn không ghi đè trạng thái đã lấy/đã đóng | #218 (đóng 30/10) |
| M10-R-19 | M10 | Mã đơn hiển thị và tương thích DIRECT cũ | Danh sách, chi tiết, thông báo | Mã quán dạng K01-0001, duy nhất và không tái sử dụng; dãy số quán áp dụng ORDER và DIRECT **cũ gắn quán**, không reset; mã DH-/G- cũ vẫn tra cứu được. Yêu cầu Gọi shipper mới do KH tạo **không bắt buộc có quán và không ép dùng counter/mã quán**; mã tham chiếu công khai riêng cần được đối chiếu contract trước khi chốt format; API vẫn dùng UUID nội bộ | Counter giao dịch theo quán cho dữ liệu gắn quán; customer delivery độc lập quán | KH, CQ theo quyền sở hữu | Không tạo mã trùng hoặc gán quán giả cho yêu cầu KH | M10-M07-filter-shop-code (22/10); #221 (Owner 26/10) → C-11 |
| M10-R-20 | M10 | Danh sách đơn quán | 11Food Đơn hàng: Đơn món / Giao hàng | Một hàng tìm kiếm + nút Lọc; mặc định Tất cả; lọc và tìm ở máy chủ. Giữ khả năng xem/xử lý giao hàng DIRECT **cũ** thuộc quán; yêu cầu Gọi shipper mới do KH tạo thuộc lịch sử Khách hàng, không tự nhập vào danh sách quản trị đơn của quán | `GET /v1/shop/me/orders`, `GET /v1/shop/me/deliveries` (lịch sử gắn quán) | CQ | Lọc rỗng → Không có đơn phù hợp + Xóa bộ lọc | M10-M07-filter-shop-code (22/10); #221 (Owner 26/10) → C-11 |
| M10-R-21 | M10 | Trao đổi đơn hàng | `/v1/customers/me/orders/:id/chat`, `/v1/shop/me/orders/:id/chat`, `/v1/shop/me/deliveries/:id/chat`, `/v1/driver/deliveries/:id/chat` | Một feed gồm tin văn bản và mốc nghiệp vụ; chat không đổi phí/trạng thái; tối đa 500 ký tự; shipper chỉ khi assignment ACTIVE | `order_chat_messages` | Bên liên quan | Không có quyền → 404; đã đóng → 409 ORDER_CHAT_CLOSED | M10-order-chat (25/10); #191 |
| M10-R-22 | M10 | Lưu trữ chat | — | Mặc định 7 ngày từ khi hồ sơ đóng (1–365); giữ chứng cứ khi có khiếu nại hoặc hold | `chat.retention_days` | SYS sửa | Hết hạn → expired:true | M10-order-chat |
| M10-R-23 | M10 | Đơn cũ bất biến `[P8]` | Chi tiết đơn cũ | Quãng đường/phí đơn cũ không đổi (ví dụ K01-0006 giữ 3.838 m). Nếu vẽ tuyến hiện tại cho đơn cũ phải ghi "chỉ tham khảo" | Snapshot | — | — | #294 |
| M10-R-24 | M10 | Lịch sử giá/số lượng bất biến | Chi tiết đơn | Lưu giá và số lượng gốc/chốt cùng actor, thời điểm, version, lý do; câu chữ không ngụ ý khách đã đồng ý | Snapshot | CQ sửa; KH xem | — | #260 (29/10) |
| M10-R-25 | M10 | Hiển thị đúng bên hủy | 11Food, Admin | Phân biệt hiển thị hủy bởi Admin/quán/hệ thống | actor hủy | — | — | #260 (29/10) |

## 11. M11 — Đánh giá và phản ánh

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M11-R-01 | M11 | Điều kiện đánh giá | Chi tiết đơn | Khách → quán khi Order hoàn thành; khách → shipper khi delivery thành công; quán → shipper khi thành công hoặc thất bại. 1–5 sao, một lần, không sửa/xóa | — | KH, CQ | Gửi lặp không tạo bản ghi mới | M11-Functional-UI-LOCKED §1 (16/10) |
| M11-R-02 | M11 | Đánh giá đúng shipper | — | Đánh giá shipper thực sự đã giao | — | — | — | #214 |
| M11-R-03 | M11 | Phản hồi của quán | Trang quán | Một phản hồi mỗi đánh giá, cập nhật có lịch sử; quán không sửa/xóa đánh giá khách | — | CQ | — | M11 §2 |
| M11-R-04 | M11 | Gửi phản ánh | Chi tiết đơn; Tài khoản → Phản ánh của tôi | 6 nhóm; nội dung bắt buộc; tối đa 5 ảnh, 5 MB/ảnh | — | KH, CQ, SP | — | M11 §4 |
| M11-R-05 | M11 | Vòng đời hồ sơ | Admin Web › Phản ánh | Chờ tiếp nhận → Đang xử lý → Chờ bổ sung → Đã giải quyết / Đóng không xử lý (bắt buộc lý do); xem xét lại trong 7 ngày sau đóng | — | AD theo scope | — | M11 §5 |
| M11-R-06 | M11 | Phản ánh không tự đổi tiền/trạng thái | — | Điều chỉnh tiền đi qua M04 với quyền riêng | — | AD (`wallet.adjustment.post`) | Thiếu số dư → M04-R-08 | M11 §7 |
| M11-R-07 | M11 | Scope Admin theo từng hồ sơ | Admin Web | Phân scope SHOP/DRIVER theo từng hồ sơ (chi tiết M11-R-08..10) | — | AD | — | #261 (29/10) |
| M11-R-08 | M11 | Phân quyền theo hồ sơ/trường/đính kèm | Admin Web | Xem ≠ xử lý ≠ tài chính; quyền bị thu hồi có hiệu lực ngay | — | AD | Thiếu quyền → 403 | #261 (29/10) |
| M11-R-09 | M11 | Shipper SUSPENDED xem phản ánh của mình | 11Ship | Vẫn đọc được hồ sơ của chính mình | — | SP | — | #261 (29/10) |
| M11-R-10 | M11 | Dọn ảnh mồ côi an toàn | Job nền | Chỉ dọn ảnh không còn liên kết, quá TTL đã duyệt, có khóa và kiểm lại trước khi xóa | — | — | — | #261 (29/10) |

## 12. M12 — Quản trị, điều hành, báo cáo (Admin Web)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M12-R-01 | M12 | Chỉ ở Admin Web | Admin Web | M12 tổng hợp và gọi command của module sở hữu, không tạo bản sao nguồn chuẩn | — | SYS, AD | — | M12-spec §1 (16/10) |
| M12-R-02 | M12 | Trạng thái màn hình | Mọi màn | Có loading/empty/error/mất kết nối/thiếu quyền; module chưa sẵn sàng hiện "chưa sẵn sàng", không phải 0 | — | — | Lỗi tải không hiện 0 | M12-spec §2 |
| M12-R-03 | M12 | Quyền ADMIN | M12-C | SYS quản lý ADMIN; ADMIN không tự nâng quyền; quyền app (can_view, can_review_profile, can_lock, can_manage_shops) theo scope SHOP và/hoặc DRIVER | — | SYS | — | M12-spec §3; G03 |
| M12-R-04 | M12 | Cấu hình tập trung | M12-D | Validate → so sánh cũ/mới → lưu có version và audit; chỉ SYS sửa hai công tắc OTP | — | SYS | — | M12-spec §3 |
| M12-R-05 | M12 | Báo cáo và xuất | M12-E | Tiền món/phí ship/nạp ví không phải doanh thu nền tảng; hoa hồng lấy từ ledger M04. Xuất theo đúng bộ lọc và quyền, kiểm cả lúc tạo và lúc tải, chống công thức bảng tính | — | AD (`report.read`, `report.export`) | — | M12-spec §4–5 |
| M12-R-06 | M12 | Nhật ký và sao lưu | M12-F | Audit chỉ đọc. Sao lưu hằng ngày, giữ 7 ngày + 4 tuần, thêm bản trước migration; bản sao ngoài VPS, mã hóa (Google Drive + rclone); khôi phục chỉ SYS | — | AD (`audit.read`); SYS | — | M12-spec §6; M12-implementation (Owner chốt) |
| M12-R-07 | M12 | Scope báo cáo/audit | Admin Web | Tổng số, danh sách, xem trước, runner xuất và tải xuống đều theo scope; wallet.read là quyền riêng | — | AD | Audit lỗi → fail-closed | #262 (29/10) |
| M12-R-08 | M12 | Hàng đợi việc, phân tích, cờ bất thường | Admin Web | Hàng đợi việc cần xử lý; phân tích; cờ bất thường chỉ gắn cờ, không tự xử lý | — | AD | — | #216; #241; #242 |
| M12-R-09 | M12 | Mini Business | PWA `/business/` | Dashboard vận hành 5 tab cho **SYSTEM và ADMIN được cấp đúng quyền**. ADMIN xem/chỉ xử lý theo grants API, không suy app VIEW là có report.read/wallet.read hay quyền sửa; 403 hiển thị thiếu quyền phù hợp. **Không tự mặc định mở PWA này cho SHOP_OWNER** | App grants + report.read / wallet.read + action guards | SYS; AD theo scope/quyền được cấp | 401/403/500/offline phải phân biệt, không rò dữ liệu hoặc xóa tab khác | #236; #237 (Owner 2026-10); business-dashboard |
| M12-R-10 | M12 | Web Push cho Mini Business (tùy chọn) | PWA `/business/` | Thông báo tài chính/chưa đọc luôn có trong PWA; nhắc một lần sau 30 phút chờ. Web Push chỉ hiện "Có cập nhật mới cần kiểm tra" và mở đúng chat; subscription gắn phiên | Subscription push | SYS, AD theo quyền | Từ chối quyền hoặc lỗi push không làm mất yêu cầu; không cấu hình VAPID vẫn có danh sách chờ | business-dashboard; G03 (26/10) |
| M12-R-11 | M12 | Bản đồ điều hành | Admin Web | Hiện LIVE/STALE theo M14-R-02 và đúng scope | — | AD | — | #262 (29/10) |
| M12-R-12 | M12 | Bằng chứng khôi phục backup | Admin Web › Sao lưu | Khôi phục thử từ bản ngoài VPS vào DB cô lập, có checksum; chưa có bằng chứng → NOT TESTED | — | SYS | — | #262 (29/10) |

## 13. M13 — Vận hành, cảnh báo, cập nhật

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M13-R-01 | M13 | Sự cố | Admin Web | NEW → ACKNOWLEDGED → IN_PROGRESS → RECOVERED → CLOSED; gộp theo fingerprint; báo Discord | — | SYS; AD được cấp | UNKNOWN/NO_DATA/STALE không bao giờ hiện xanh | M13-implementation (23/10) |
| M13-R-02 | M13 | Không có nút deploy | Admin Web | Chỉ ghi lịch sử deploy và health check | — | — | — | M13-implementation (Owner) |
| M13-R-03 | M13 | Probe bên ngoài | Ngoài VPS | Probe chạy ngoài VPS + Discord độc lập là điều kiện nghiệm thu; trạng thái trung thực | — | — | Mất tín hiệu → báo mất tín hiệu, không suy ra down | #264 (29/10) |
| M13-R-04 | M13 | Giám sát VPS | Admin Web › Vận hành › Giám sát VPS | Chỉ đọc: CPU, RAM, disk, mạng, top tiến trình, backend/PostgreSQL; lịch sử 1h/24h/7d/30d, mẫu 30 s; cảnh báo Discord (CPU >85% 5 phút, RAM khả dụng <10% 5 phút, disk >85%, backend/DB không đáp ứng, mất mẫu >3 phút) | Mẫu giám sát, retention | SYS; AD được cấp | Mất mẫu → khoảng trống, không nội suy; ghi "mất tín hiệu giám sát" | #247 (đóng 30/10) |
| M13-R-05 | M13 | Kiểm tra phiên bản không phụ thuộc phiên đăng nhập | `/check` / API version (guest được truy cập) | So sánh versionCode từng app FOOD/SHIP khi mở/resume; có bản mới hiện **popup nhẹ** với Cập nhật và Để sau, không popup chặn toàn trang, không tự quyết định shipper đang có đơn/khóa nút cập nhật; không yêu cầu đăng nhập. Thông tin `min_supported_version_code` của backend chỉ phản ánh tương thích, **không phục hồi UX chặn tải APK** đã bị #280 thay thế | Phiên bản, metadata và điều kiện tương thích backend hiện hữu | KH/CQ/SP hoặc khách chưa đăng nhập | Offline/API lỗi không báo giả đã mới; không làm mất chức năng và kiểm lại sau | #280 (Owner 31/10, thay thế UX M13 cũ); M13-apk-backend-compat (25/10) → C-14 |
| M13-R-06 | M13 | Kênh cập nhật mới và chuyển tiếp | 11Food/11Ship → popup Cập nhật | Baseline mới **chỉ kiểm phiên bản, thông báo và mở listing Google Play thật khi đã phát hành**, không tải/cài APK hoặc theo dõi tiến trình qua VPS; Để sau hoạt động. **Trong giai đoạn chưa có kênh Play khả dụng**, giữ đường nâng cấp APK cũ cho người dùng đang lưu hành (không gỡ file/endpoint cũ, không trỏ tới Play giả), nhưng không coi tự tải APK là chức năng mục tiêu của M13 mới. Chỉ chuyển kênh sau khi xác minh package, signing, link, versionCode và nâng cấp được bản cũ | Release FOOD/SHIP riêng; legacy 0.1.470 cần đường nâng cấp | — | Thiếu listing Play → không chuyển người dùng sang URL giả hoặc làm đứt cập nhật | #280 (Owner 31/10) → C-14 |
| M13-R-07 | M13 | Nhật ký lỗi | Admin Web | Chỉ SYS đọc; không lưu SQL/mật khẩu/token/OTP/số tài khoản/ảnh/địa chỉ khách | — | SYS | — | M13-error-logs (21/10) |
| M13-R-08 | M13 | Vận hành SMS Gateway | App Gateway Android; Admin Web (giám sát) | Gateway gửi telemetry và tự cập nhật khi rảnh; hàng đợi OTP hiển thị nhãn "Đăng ký / Quên mật khẩu" | Thiết bị gateway, hàng đợi | SYS; AD được cấp | Không đọc được trạng thái → không hiện xanh | M13-implementation (23/10) |
| M13-R-09 | M13 | Báo cáo deploy | — | START/FINISH gắn SHA bất biến, health check, idempotency | — | — | — | #264 (29/10) |
| M13-R-10 | M13 | Log Android | App | Log ACTION/MAP/ROUTE/GPS/PUSH được che dữ liệu nhạy cảm, có giới hạn, gửi lại khi có mạng | — | — | — | #264 (29/10) |

## 14. M14 — GPS, bản đồ, định tuyến

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M14-R-01 | M14 | GPS nền khi Online | 11Ship (foreground service) | GPS nền khoảng 60 s/lần, có thông báo thường trực. Tắt Online thì dừng GPS kể cả khi còn chuyến | `should_share_location` = intent_online và ACTIVE | SP | — | #265 (29/10) → C-07 |
| M14-R-02 | M14 | Độ mới vị trí | — | LIVE ≤ 120 s; STALE ≤ 600 s; shipper Offline không bao giờ vẽ là LIVE | — | — | — | #265; M14-online-location |
| M14-R-03 | M14 | Ngưỡng độ chính xác → C-19 | — | Mẫu có sai số > 500 m không đủ tin cậy để nhận việc. Cách xử lý accuracy null/0 chưa chốt (C-19) | — | — | — | #265 (29/10) |
| M14-R-04 | M14 | Phiên khóa báo vị trí | — | Đăng xuất/thu hồi phiên thì không báo vị trí và không nhận đơn được | — | SP | 401 → dừng dịch vụ | M14-online-location |
| M14-R-05 | M14 | Một cảnh báo đúng nguyên nhân | 11Ship Home | Một vùng đỏ duy nhất theo thứ tự ưu tiên (mất Internet, lỗi máy chủ, lỗi gửi vị trí, tạm dừng do vị trí cũ…) | — | SP | — | M14-home-alerts (25/10); #194 |
| M14-R-06 | M14 | Camera và cử chỉ bản đồ | Bản đồ | Giữ pan/pinch và fit theo ngữ cảnh; **riêng Home 11Ship** fit vùng bán kính nhận 3 km + padding (không còn mặc định khoảng 5 km ở màn này); bản đồ tuyến fit đầy đủ các điểm/tuyến | GPS/viewport | — | Không tự giật camera khi người dùng đang thao tác | #203; #215; #294 (Owner 01/11) → C-12 |
| M14-R-07 | M14 | Tìm địa điểm offline | Bản đồ | Tìm địa điểm Cao Bằng offline | — | — | — | #283 |
| M14-R-08 | M14 | Không lưu lịch sử GPS chính thức | — | Không lưu chuỗi GPS trên điện thoại hay máy chủ chính thức; chỉ vị trí mới nhất | — | — | — | M10 §17; M14-integration |
| M14-R-09 | M14 | Tracking theo delivery hiện hành | Chi tiết đơn | Bám assignment hiện hành; dừng live khi đơn kết thúc; không giả tọa độ | — | KH, CQ theo quyền | — | M10 §17 |
| M14-R-10 | M14 | Một hợp đồng định tuyến `[P8]` | Routing service (Valhalla trên VPS) | Tuyến xe máy ngắn nhất **hợp lệ**; trả distance_m, ETA, geometry, route_version; không fallback đường thẳng. Trạng thái runtime xem C-15 | Route snapshot/version; M14_ROUTING_ORIGIN đã kết nối staging | — | Không có route → ROUTE_DATA_UNAVAILABLE, không giả 0 hay đường thẳng | #294 (Owner 01/11); #239; comment #238 (31/10) → C-15 |
| M14-R-11 | M14 | Bản đồ vẽ đúng tuyến đã báo giá `[P8]` | Bản đồ checkout/chi tiết đơn | Polyline là chính tuyến đã dùng để tính giá | geometry + route_version | — | — | #294 |
| M14-R-12 | M14 | Vòng 3 km trên Home 11Ship `[P8]` | 11Ship Home | Tâm là GPS shipper, đường thẳng. Bên trong trong suốt, bên ngoài phủ xám; camera vừa 3 km + lề | — | SP | — | #294 → C-12 |
| M14-R-13 | M14 | Ý định Offline thắng race | 11Ship | Tắt Online có generation theo phiên; xử lý race và đồng bộ lại với máy chủ | — | SP | — | #265 (29/10) |
| M14-R-14 | M14 | GPS nền bền vững | Android | Chạy tiếp khi chuyển app, khóa màn hình, vuốt khỏi gần đây; có thông báo thường trực; nêu rõ giới hạn force-stop | — | SP | — | #265 (29/10); M14-online-location |
| M14-R-15 | M14 | Vị trí cuối khi Offline | 11Food, Admin | Không hiện LIVE; không lộ sau khi hết quyền xem | — | Theo quyền | — | #265 (29/10) |

## 15. Ma trận nguồn theo mục Phase 1

Phase 1 dùng các dòng trên làm đầu vào cho:
- **B-00:** script kiểm kê đảm bảo mọi module, route, bảng, route Admin, màn mobile, runner và workflow map vào ít nhất một dòng. Dòng nào không map được thì bổ sung hoặc đánh dấu.
- **B-02:** Codex lập ma trận ánh xạ.
- **B-03:** smoke test.

## 15b. Kết quả B-02 (Codex, head c30747b) và xử lý của Lead

Ma trận B-02 đã map 163/163 Req ID. Lead xử lý chiều ngược như sau:

- **Đã bổ sung dòng mới (có nguồn loại A):** M01-R-17 (mời/kích hoạt ADMIN), M01-R-18 (SMS Gateway là kênh OTP duy nhất), M01-R-19 (ràng buộc thiết bị, nguồn gián tiếp), M02-R-15 (nhóm món hệ thống), M12-R-10 (Web Push Mini Business), M13-R-08 (vận hành SMS Gateway).
- **Chuyển Phase 3/4 làm ứng viên phát hiện, không thêm vào baseline:**
  - `VoucherScreen` trên mobile, trong khi M10-R-02 và M02-discovery ghi rõ chưa có voucher.
  - M01-R-11: không tìm thấy route mobile để người dùng tự xóa tài khoản.
  - `DiagnosticsView`, `AdminLimitConfigVerifier`, thao tác bảo trì/truy cập ops, bảng `admin_sensitive_operations`: chưa thấy nguồn loại A. Phase 3 xác định nguồn gốc (PR/issue), sau đó Owner quyết giữ hay bỏ.
- **Không phải yêu cầu chức năng:** các workflow governance/CI/progress, `sms-gateway-apk.yml` (build), test/spec/helper.

## 15c. Áp review Codex B-02 (review 5729004799, head c30747b)

- Sửa 21 dòng sai nguồn/ngày/nội dung (ngày #251–#258 là 28/10; M02-R-10 trỏ đúng M04-R-11; M10-R-18, M13-R-04 viết lại tự đủ; M14-R-10 tách trạng thái runtime sang C-15).
- Thêm 25 dòng mới cho các yêu cầu Codex đề xuất (3 ý còn lại gộp vào dòng sẵn có: xem trước/không xóa cứng khu vực → M02-R-04, chuyển M11 → M07-R-09, probe ngoài VPS → M13-R-03). ID đánh tiếp nối (Codex đề xuất ID trùng với các dòng v0.3 nên đã đánh số lại): M01-R-20..22, M02-R-16..17, M03-R-09..10, M04-R-14, M06-R-11..12, M07-R-16, M08-R-14..15, M10-R-24..25, M11-R-08..10, M12-R-11..12, M13-R-09..10, M14-R-13..15.
- Đăng ký C-16..C-20, chờ Owner quyết.
- BLOCKED nguồn: số liệu/bộ lọc màn Thu nhập (#255) chưa có contract, không tạo Req ID.
- Ứng viên Phase 3: không tìm thấy `route_version`/geometry trong code (M14-R-10).

## 16. Conflict Register (B-05)

**Owner đã quyết ngày 01/11/2026:** cả **15/15 xung đột nguồn đã được chốt (RESOLVED)**; C-08 theo #213, C-11 theo #221, 13 mục còn lại theo đề xuất QA, với diễn giải C-14/C-15 bên dưới. Quyết định này chốt **đặc tả nghiệp vụ**, không xác nhận code, UAT hoặc merge PR #298.

| ID | Chủ đề | Nguồn A | Nguồn B | Quyết định Owner (01/11/2026) |
|---|---|---|---|---|
| C-01 | Rút tiền khi bị khóa | M01-final-package: shipper bị khóa được yêu cầu rút, tối thiểu 10.000 đ | #255: chỉ rút khi CLOSING, không có mức tối thiểu | Theo #255: chỉ rút toàn bộ số dư trong CLOSING; SUSPENDED có đường vào CLOSING không cần mở khóa |
| C-02 | Điều kiện rút tiền | M04-C: rút tối thiểu 10.000 đ, ngân hàng phải VERIFIED, cần ≥100k đã nạp | M03-simplified + #255 | Theo #255: không mức rút tối thiểu và không bắt buộc ngân hàng VERIFIED từ trước; Admin **phải** xác minh người thụ hưởng trước khi trả tiền (M03-R-10), không bỏ kiểm an toàn |
| C-03 | Bán kính tìm shipper | M03-UI-LOCKED, M06-design: 5 km | M06-v1.1: 3 km | Bán kính EXTERNAL 3.000m đường thẳng (Haversine) theo M06-v1.1, không nhầm với độ dài tuyến tính phí |
| C-04 | Xác minh ngân hàng là điều kiện nhận đơn | M06-BC | #257, M03-simplified | Theo #257: bỏ yêu cầu ngân hàng VERIFIED khỏi điều kiện Online/nhận đơn |
| C-05 | Khoảng cách trên trang khám phá | M02-discovery 16/10: không hiện khoảng cách; #147: Haversine; #206: chỉ đường đi | #294: quán → GPS hiện tại (ngược chiều với code hiện tại) | Theo #294: Home/Tìm kiếm/Chi tiết quán đo **quán → GPS hiện tại** bằng tuyến xe máy ngắn nhất hợp lệ; checkout dùng quán → điểm giao đã chọn |
| C-06 | Quyền ghi nhận thanh toán quán | business-dashboard: dùng wallet.topup.record | G03: shop.payment.* | Theo G03: quyền `shop.payment.*`, không dùng `wallet.topup.record` thay thế |
| C-07 | GPS khi còn chuyến | M14-online-location 24/10: còn chuyến vẫn giữ GPS | #265: tắt Online là dừng GPS | Theo #265: tắt Online thì dừng gửi GPS kể cả khi đang có chuyến, nhưng giữ trách nhiệm với chuyến đã nhận |
| C-08 | Hiển thị đã trả/còn phải thu | #213: hiện | M07 23/10: bỏ khỏi UI | **Theo #213 (Owner 26/10): hiện Đã thanh toán / Còn phải thanh toán ở 11Food KH/CQ; ghi rõ phần tiền món và phí, không suy đoán đã thu từ trạng thái giao** |
| C-09 | Giới hạn chat tài chính | #199: 1000 ký tự | G03: 500 grapheme | 500 grapheme theo G03 cho mini chat tài chính; không lấy giới hạn 1000 ký tự cũ |
| C-10 | Bước "món sẵn sàng" | M10 §6: hai thao tác độc lập | M07 23/10: bỏ bước ready | Theo M07 23/10: bỏ nút/bước món sẵn sàng riêng; quán gọi shipper nghĩa là món đã sẵn sàng |
| C-11 | DIRECT do quán tạo | M07 23/10: có DIRECT do quán tạo | #221: bỏ DIRECT độc lập của quán | **Theo #221 (Owner 26/10): bỏ lối tạo DIRECT độc lập của quán; chủ quán gửi ngoài app qua chế độ Khách; giữ Gọi shipper cho đơn món; bảo toàn DIRECT cũ và quyền creator** |
| C-12 | Camera bản đồ | #203: khoảng 5 km | #294: vừa 3 km | Theo #294: riêng bản đồ Home 11Ship fit vòng 3km + padding, trong rõ/ngoài xám; các màn khác fit đúng ngữ cảnh |
| C-13 | Điều khoản | terms v1 / privacy v1 | Bản nháp v2 (31/10) | Giữ terms v1/privacy v1 đang hiệu lực; v2 chỉ là nháp cho đến khi Owner duyệt |
| C-14 | Kênh cập nhật | #280: chỉ kiểm phiên bản + Google Play | Giữ đường APK cũ khi chuyển tiếp | **Phân biệt trạng thái:** M13 mục tiêu mới theo #280 = chỉ so sánh phiên bản + popup + mở Google Play thật. APK tự host **chỉ là đường nâng cấp legacy trong chuyển tiếp** khi Play chưa xác nhận, không được gỡ làm đứt bản cũ và không thuộc UX mới |
| C-15 | Trạng thái routing Valhalla | #239 đã đóng nhưng routing chưa deploy, M14_ROUTING_ORIGIN chưa đặt | Comment #238 (31/10): Valhalla chạy trên VPS | **Đã có bằng chứng runtime staging 31/10:** Valhalla 3.9.1 trên VPS, `M14_ROUTING_ORIGIN` đã cấu hình, 5 quán có quãng đường và sửa địa chỉ tính lại. **Chưa nghiệm thu hết** shortest xe máy, snapshot/geometry, mọi màn, chống lệch phí; Phase 6/8 cần kiểm thực tế, không ghi toàn bộ routing là NOT DEPLOYED |
| C-16 | Khu vực ACTIVE thiếu geometry | #252: không coi là đã xác minh, phải leo thang | G14: tương thích cũ, chấp nhận/hiện công khai, ghi chờ Owner | **CHƯA QUYẾT** — Owner chọn |
| C-17 | Admin "Chuyển M11" | Tạo hồ sơ M11 thật | Chỉ đánh dấu cần theo dõi + đổi nhãn | **CHƯA QUYẾT** — Owner chọn (#258) |
| C-18 | Đổi tên shipper khi đã có ngân hàng/yêu cầu rút | #255 cho sửa tên | Chính sách danh tính/thụ hưởng chưa khóa | **CHƯA QUYẾT** — Owner chọn |
| C-19 | Accuracy null/0 khi nhận việc | Hiện chấp nhận null | #265: đổi phải có bằng chứng + Owner quyết | **CHƯA QUYẾT** — Owner chọn |
| C-20 | Ai được xóa tài khoản | M01-final-package: chỉ Admin thực hiện | Baseline v0.1 ghi chủ tài khoản tự xóa | **CHƯA QUYẾT** — Owner chọn |

## 17. Quyết định đã chốt và phần còn cần nghiệm thu

1. **C-01…C-15 đã chốt theo Owner ngày 01/11/2026.** Không đưa hai xung đột C-08/C-11 quay lại bàn quyết nếu không có quyết định mới.
2. **M10-R-09 thuộc baseline bắt buộc** theo #238: sửa đơn phải chọn địa chỉ khác/tìm offline/điều chỉnh ghim ngay trong luồng; phần thiếu là gap cần test red→green tại Phase 8, không phải đề xuất feature mới.
3. **M12-R-09:** Mini Business `/business/` dành cho SYSTEM/ADMIN theo quyền chức năng, đối chiếu #236/#237; không tự cấp SHOP_OWNER quyền Admin PWA.
4. **C-14:** trước chuyển cập nhật sang Play phải xác nhận cả hai listing thật và kênh nâng cấp tương thích cho APK cũ; không bật URL giả, không xóa legacy khi còn người dùng phụ thuộc.
5. **C-15:** runtime staging đã có bằng chứng; kiểm định tính đúng của tuyến, snapshot, chi phí và polyline vẫn là việc chưa nghiệm thu ở Phase 6/8.
6. Các dòng `[P8]` (#294, #295 và gap #238) chỉ nhận diện lỗi của chức năng cũ để sửa bằng test red→green tại Phase 8; việc sửa tài liệu tại Phase 1 không đồng nghĩa lỗi đã được khắc phục.
7. **PR #298 vẫn mở, không merge/deploy.** Cần phản biện Codex (B-02), Antigravity, smoke B-03 và Owner chốt B-04 sau review.

## 18. Phản biện tiếp theo

- **Codex:** kiểm từng dòng với nguồn, chỉ ra dòng thiếu/sai, lập B-02.
- **Antigravity:** phản biện chéo module, nhất là luồng M10↔M07↔M04↔M14.
- **Owner:** đã chốt C-01…C-15 ngày 01/11; tiếp tục quyết định B-04 sau phản biện và kiểm chứng, không tự merge.
