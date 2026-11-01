# 11Ship — Functional Baseline (B-01)

**Phiên bản:** v0.1 (bản nháp để phản biện) · **Ngày lập:** 2026-11-01 · **Người lập:** Claude Lead
**Trạng thái:** DRAFT. Chờ Codex/Antigravity phản biện độc lập, sau đó Owner xác nhận ở cổng B-04.
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
  - **`→ C-xx`:** dòng phụ thuộc một xung đột chưa được Owner quyết.
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
| M01-R-11 | M01 | Xóa tài khoản | Tài khoản → Xóa | Không có dữ liệu liên quan: xóa hẳn (purge). Có dữ liệu liên quan: khóa với lý do DELETE_REQUEST | — | Chủ tài khoản | Còn việc đang chạy → chặn | M01-final-package; #251 |
| M01-R-12 | M01 | Khóa/xóa an toàn | Admin khóa; người dùng xóa | Kiểm việc đang chạy qua adapter thật của M10, M07, M04, M11. Tách activeWork (chặn) khỏi relatedData (chọn purge hay khóa). Chống race TOCTOU | — | AD (can_lock) | Còn việc → lỗi rõ, không khóa | #251 (29/10) |
| M01-R-13 | M01 | Tài khoản test OTP | — | Tài khoản test luôn ở PHONE_UNVERIFIED | — | — | — | #251 |
| M01-R-14 | M01 | Điều khoản và quyền riêng tư | Đăng ký | Bản hiện hành: terms-20261014-v1, privacy-20261017-v1. Bản nháp v2 (31/10) chưa được duyệt → C-13 | Phiên bản đồng ý lưu theo user | — | — | M01-terms-privacy (14/10, 17/10); M01-terms-privacy-draft (31/10) |
| M01-R-15 | M01 | Đăng xuất có hiệu lực ngay `[P8]` | Tài khoản → Đăng xuất (11Ship, 11Food) | UI chuyển ngay sang trạng thái khách/chưa đăng nhập; dừng mọi luồng riêng của phiên (push, GPS, long-poll). Máy chủ vẫn là bên quyết định | Session bị thu hồi | — | Response đến muộn của phiên cũ bị bỏ qua | #295 (01/11); M08 §9; M14-online-location |
| M01-R-16 | M01 | Đổi tài khoản không lộ dữ liệu `[P8]` | Đăng xuất A → đăng nhập B | B không bao giờ thấy dữ liệu của A (ví, đơn, thông báo), kể cả khi response của A về muộn | Cache theo tài khoản | — | Bỏ dữ liệu không thuộc phiên hiện tại | #295; M08 §9 |

## 3. M02 — Quán, thực đơn, khám phá (gồm M09 cũ)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M02-R-01 | M02 | Thiết lập quán 4 bước | 11Food (CQ) | Bước 1 tài khoản; bước 2 hồ sơ + giờ mở cửa; bước 3 ghim điểm lấy hàng; bước 4 có ít nhất 1 món VISIBLE giá > 0. Đủ 4 bước thì tự kích hoạt | Trạng thái setup | CQ | Thiếu bước nào thì báo đúng bước đó | issue-190-shop-setup (25/10); #190 |
| M02-R-02 | M02 | Một cổng chặn thống nhất | Mọi API công khai về quán | ShopSetupGate là cổng duy nhất quyết định quán có hiện công khai hay không | — | — | Quán chưa đủ điều kiện không xuất hiện | #190 |
| M02-R-03 | M02 | Ghim quán trên bản đồ | Bước 3 setup | Ghim trên bản đồ, không bắt buộc có GPS. Ghim phải nằm trong khu vực phục vụ. Hoàn thành lại đủ 4 bước thì xóa NEEDS_REVIEW | Tọa độ quán | CQ | Ngoài khu vực → từ chối, báo rõ | #252 (29/10) |
| M02-R-04 | M02 | Quản lý khu vực phục vụ | Admin Web | CRUD khu vực phục vụ | `service_areas` | Chỉ SYS | — | #253 (29/10) |
| M02-R-05 | M02 | Giờ mở cửa theo lịch | Cài đặt quán | Mở/đóng chỉ theo lịch, không có công tắc tay. Giờ đóng là exclusive, múi giờ Asia/Ho_Chi_Minh. App tự làm mới ở ranh giới mở/đóng kế tiếp và khi quay lại app | Lịch tuần | CQ | — | M02-workstreams; #204 |
| M02-R-06 | M02 | Chọn giờ bằng dropdown | Cài đặt giờ | Chọn giờ bằng dropdown | — | CQ | — | M02-shop-logo-time-dropdown (20/10) |
| M02-R-07 | M02 | Logo quán | Hồ sơ quán | Logo tùy chọn, tối đa 1 MiB | — | CQ | Quá cỡ → lỗi rõ | M02-shop-logo-time-dropdown (20/10) |
| M02-R-08 | M02 | Liên kết liên hệ | Hồ sơ quán | Chỉ chấp nhận https. Zalo/Facebook không bắt buộc, giới hạn 160/300 ký tự | — | CQ | Lỗi dưới ô | #190; shared-address-picker |
| M02-R-09 | M02 | Món ăn | Thực đơn (CQ) | Mô tả tùy chọn, tối đa 300 ký tự. Ảnh tùy chọn. Cắt ảnh WYSIWYG | Món: VISIBLE/ẩn/xóa | CQ | — | #207; #209; #245 |
| M02-R-10 | M02 | Giới hạn số món hiển thị | Thực đơn | Mặc định 20 món VISIBLE; tăng bằng entitlement riêng (M04-R-14) | Entitlement | CQ; AD (`shop.entitlement.manage`) | Vượt giới hạn → chặn, báo rõ | G03 (26/10) |
| M02-R-11 | M02 | Tìm quán/món | 11Food Home/Tìm kiếm | Tìm không dấu, có bộ lọc; Home có khối "Quán gần bạn" | — | KH | — | M02-discovery-UI-LOCKED (16/10); M02-home-shop-detail-UI-OWNER (22/10) |
| M02-R-12 | M02 | Khoảng cách trên Home/Tìm kiếm/Chi tiết quán `[P8]` → C-05 | 11Food Home, Tìm kiếm, Chi tiết quán | Luôn là quãng đường **từ quán → GPS hiện tại của khách**, theo hợp đồng M14 (M14-R-10), ghi nhãn rõ ý nghĩa. Không có GPS thì hiện "chưa xác định". Không dùng đường thẳng | Cache khoảng cách | KH | Đổi GPS → bỏ cache; lỗi tuyến → "chưa xác định" | #294 (01/11); #206 |
| M02-R-13 | M02 | Admin quản lý quán | Admin Web › Quán | Xem/khóa/tắt quán theo quyền | — | AD (`can_manage_shops`) | Còn việc mở → SHOP_HAS_OPEN_WORK | M02-admin-shops (24/10) |
| M02-R-14 | M02 | Banner trạng thái không lỗi thời | 11Food (CQ) | Banner trạng thái quán khớp dữ liệu máy chủ | — | CQ | — | #281 |

## 4. M03 — Shipper

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M03-R-01 | M03 | Đăng ký shipper đơn giản | Đăng ký 11Ship | Tạo DRIVER ở trạng thái ACTIVE kèm ví 0 đ. Không cần khu vực, ngân hàng hay duyệt hồ sơ | `drivers`, ví | SP | — | M03-simplified-onboarding (20/10) → C-02, C-04 |
| M03-R-02 | M03 | Ngưỡng nạp ban đầu | Nhận đơn | Phải nạp đủ ngưỡng ban đầu mới được nhận đơn | Cấu hình ngưỡng | SYS cấu hình | Chưa đủ → không nhận đơn, báo lý do | M03-simplified-onboarding |
| M03-R-03 | M03 | Sửa tên shipper | Hồ sơ 11Ship | Shipper sửa được tên hiển thị | — | SP | — | #255 (29/10) |
| M03-R-04 | M03 | Đóng tài khoản (CLOSING) | Hồ sơ → Đóng tài khoản | Shipper SUSPENDED vào được CLOSING mà không cần mở khóa. Hủy/từ chối đóng thì quay về trạng thái trước (SUSPENDED vẫn là SUSPENDED) | ACTIVE/SUSPENDED → CLOSING → CLOSED | SP; AD duyệt | Còn việc → DRIVER_HAS_ACTIVE_WORK; ví chưa về 0 → DRIVER_WALLET_NOT_SETTLED | #255 |
| M03-R-05 | M03 | Rút tiền chỉ khi đóng tài khoản | Ví (CLOSING) | Chỉ rút được khi CLOSING, rút toàn bộ số dư, không có mức tối thiểu. Rút là một hold; PAID ghi đúng một WITHDRAWAL_DEBIT | Hold rút tiền | SP; AD xử lý | — | #255 → C-01, C-02 |
| M03-R-06 | M03 | Điều kiện CLOSED | Admin | Chỉ CLOSED khi số dư, hold và mọi khoản về 0 | — | AD | Chưa về 0 → chặn | #255 |
| M03-R-07 | M03 | Online = chia sẻ vị trí (một nút) | Công tắc Online (Home, hồ sơ) | Bật online tự bật chia sẻ vị trí. Chỉ bật được khi máy chủ đã nhận vị trí hợp lệ còn mới | `intent_online` | SP | Chưa có vị trí → 409 DRIVER_LOCATION_NOT_READY | M14-online-location (24/10); `POST /driver/me/accepting` |
| M03-R-08 | M03 | Tắt online luôn được | Công tắc Online | Tắt luôn được, ngừng nhận đơn mới ngay, dừng GPS kể cả khi còn chuyến. Chuyến, phí, hoa hồng, hàng đang giữ không bị đụng | — | SP | — | #265 (29/10); M14-online-location (cập nhật 29/10) |

## 5. M04 — Ví shipper, nạp/rút, thanh toán quán

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M04-R-01 | M04 | Bất biến ví | — | 0 ≤ held ≤ balance; balance = SUM(ledger); held = SUM(active holds). Một ví mỗi shipper | `driver_wallets`, `wallet_ledger_entries`, `wallet_holds` | — | Vi phạm → rollback | ADR-004; M04-A1 (17/10) |
| M04-R-02 | M04 | Ledger chỉ ghi thêm | — | Không sửa/xóa bút toán; điều chỉnh bằng bút toán mới | append-only | — | — | ADR-004; M04-A1 |
| M04-R-03 | M04 | Hold một lần | M07 nhận/giao/hủy | Hold active → captured hoặc released đúng một lần | Hold active/captured/released | — | Lặp → idempotent | M04-A2-1 (17/10); buoc-4.1 §5 |
| M04-R-04 | M04 | Yêu cầu nạp tiền | 11Ship Ví → Nạp | Vòng đời PENDING → CONFIRMED / REJECTED / CANCELLED | `wallet_topups` | SP | — | M04-B2-1 (18/10) |
| M04-R-05 | M04 | Chỉ Admin ghi có ví | Admin Web › Tài chính | Chỉ Admin xác nhận với số tiền thực nhận mới cộng vào ví. Mã giao dịch ngân hàng là duy nhất | — | AD (`wallet.topup.record`) | Trùng mã giao dịch → từ chối | M04-B2-2b (18/10) |
| M04-R-06 | M04 | Tài khoản nhận tiền | Admin cấu hình | Tài khoản có can_receive=false thì đóng (fail-closed) | — | SYS | Không hiện tài khoản không nhận | M04-B1; M04-B2-2a |
| M04-R-07 | M04 | Nạp khi CLOSING | Ví (CLOSING) | Không tạo yêu cầu nạp mới. Tiền chuyển đến muộn vẫn được đối soát. Mã chuyển khoản là P2 | — | SP; AD | Tạo mới → chặn | #256 (29/10) |
| M04-R-08 | M04 | Điều chỉnh khi thiếu số dư | M11 kết luận → M04 | Thiếu số dư thì ghi PENDING_FINANCE, không âm ví, không đụng tiền đang giữ. Thử lại dùng cùng adjustment_id | `wallet_adjustments` | AD (`wallet.adjustment.post`) | — | #219; M11 §7 |
| M04-R-09 | M04 | Quyền tài chính Admin | Admin Web | Quyền tách riêng: wallet.read, wallet.topup.record, wallet.adjustment.post | — | SYS cấp | Thiếu quyền → 403 | G03 (26/10); #262 |
| M04-R-10 | M04 | Thanh toán phí quán | Admin Web › Quán › Thanh toán | Không có gói thuê bao, không có ví quán. Quán báo đã chuyển khoản không tự cấp quyền gì | `shop_payments` | AD (`shop.payment.read/record`) → C-06 | — | G03 (26/10); #198 |
| M04-R-11 | M04 | Entitlement quán | Admin Web | Cấp entitlement là thao tác riêng, tách khỏi ghi nhận thanh toán | — | AD (`shop.entitlement.manage`) | — | G03; #198 |
| M04-R-12 | M04 | Chat tài chính quán | Quán ↔ Admin | Tin tối đa 500 grapheme; chat không phải thao tác tài chính | — | CQ; AD | Quá dài → từ chối | G03; #199 → C-09 |
| M04-R-13 | M04 | Ví chỉ hiện khi đã đăng nhập `[P8]` | 11Ship Tài khoản, Thu nhập, Home, deep link, thông báo | Mục "Ví của tôi" và mọi lối vào ví bị ẩn khi là khách, đã đăng xuất, phiên hết hạn/bị thu hồi, chưa xác minh hoặc đang khởi động. Chỉ hiện khi đã đăng nhập. Giữ hành vi lockedWalletOnly | — | SP | Deep link vào ví khi chưa đăng nhập → về màn đăng nhập | #295 (01/11) |

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
| M06-R-09 | M06 | Màn M06 không trùng lặp | 11Ship | Bỏ các màn M06 trùng nhau; phân biệt sàng lọc trước với kiểm tra ghép | — | SP | — | #257 (29/10) |
| M06-R-10 | M06 | Vị trí quá hạn | Danh sách/nhận đơn | Quá 120 s: ẩn danh sách (LOCATION_STALE), từ chối nhận DELIVERY_NOT_ELIGIBLE (kiểm lại trong transaction), bỏ qua khi phân phối | — | — | — | M14-online-location (24/10) |

## 8. M07 — Giao hàng (delivery, assignment)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M07-R-01 | M07 | Không có bước "món sẵn sàng" riêng | 11Food (CQ) | Bỏ bước "ready". Bấm "Gọi shipper" nghĩa là món đã sẵn sàng | — | CQ | — | M07-owner-delivery-flow (23/10) → C-10 |
| M07-R-02 | M07 | Shipper nhả đơn trước pickup | 11Ship | Trước pickup shipper được nhả đơn; tìm lại theo hạn còn lại, không reset hạn | Assignment | SP | — | M07-owner-delivery-flow; M08 §4 |
| M07-R-03 | M07 | Sau pickup chỉ có "Giao thành công" | 11Ship | Sau pickup không có nút thất bại hay nhả đơn | DELIVERED | SP | — | M07-owner-delivery-flow (23/10) |
| M07-R-04 | M07 | Hủy sau pickup | 11Food | Chỉ bên tạo được hủy: ORDER → khách; DIRECT → quán. Không tự hủy sau pickup | — | KH hoặc CQ | — | M07-owner-delivery-flow |
| M07-R-05 | M07 | Giao trực tiếp (DIRECT) | 11Food "Gọi ship" | DIRECT không có GPS, không có tracking | — | CQ | — | M07-owner-delivery-flow → C-11 |
| M07-R-06 | M07 | Thương lượng lại phí | Đề nghị phí mới | Bên trả phí quyết định. Hết hạn trả lời mặc định 5 phút, SYSTEM cấu hình được | — | Bên trả phí; SYS | Hết hạn → giữ phí cũ | M07-owner-delivery-flow (bổ sung 24/10) |
| M07-R-07 | M07 | Không liên lạc được khách | 11Ship | Shipper gọi cho quán; app không can thiệp | — | SP | — | #258 (29/10) |
| M07-R-08 | M07 | Shipper bị SUSPENDED | — | Giữ assignment đang có | — | — | — | #258 |
| M07-R-09 | M07 | Nút "chuyển M11" trung thực | 11Ship | Nút chỉ làm đúng điều nó ghi | — | SP | — | #258 |
| M07-R-10 | M07 | Không có nút Bỏ qua | 11Ship danh sách đơn | Không có nút Skip | — | SP | — | #212 |
| M07-R-11 | M07 | Khách "Gọi shipper" | 11Food tab "Gọi ship" | COD chỉ là thông tin; GPS tùy chọn; tracking chỉ khi cả hai điểm có GPS; có link tracking công khai | — | KH | — | #221; #282 → C-11 |
| M07-R-12 | M07 | Trợ giúp trong đơn | Chi tiết đơn | Có lối trợ giúp ngay trong đơn | — | KH, CQ, SP | — | #217 |
| M07-R-13 | M07 | Hạn tìm shipper | — | Nhắc 5 và 15 phút; ngừng tìm ở phút 30. Hủy nhận giữ mốc cũ; gọi lại tạo delivery mới với mốc mới | Mốc lưu DB | — | Restart không reset | M08 §5; M10-timeouts |
| M07-R-14 | M07 | Ba hành động hủy khác nhau | 11Food, 11Ship | Hủy đơn món / Hủy yêu cầu giao / Shipper hủy nhận là ba nút khác nhau, không dùng nút "Hủy" mơ hồ | — | Theo M10-R-10 | Race hủy vs pickup → một bên thắng | M10 §9 |
| M07-R-15 | M07 | Quãng đường cố định suốt vòng đời đơn `[P8]` | Delivery | Dùng cùng `distance_m` đã báo giá cho delivery, phí và hiển thị; tuyến vẽ là tuyến đã báo giá | `route_distance_m` | — | — | #294 |

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
| M08-R-11 | M08 | FCM hoãn | — | Push thật trên Android hoãn tới khi chuẩn bị Google Play. Kết quả rút tiền đi vào hộp thư trong app | — | — | Thiếu cấu hình → PROVIDER_NOT_CONFIGURED | Owner 18/10; #259 (29/10) |
| M08-R-12 | M08 | Counter Admin có scope | Admin Web | Bộ đếm việc cần xử lý chỉ đếm trong scope của ADMIN | — | AD | — | #259 |
| M08-R-13 | M08 | Chạm thông báo tự đổi vai trò | App | Chạm thông báo của vai trò khác thì app tự chuyển vai trò | — | — | — | #202 |

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
| M10-R-09 | M10 | Khách sửa đơn khi chờ xác nhận | 11Food chi tiết đơn | Được sửa khi PENDING_CONFIRMATION, có kiểm version. Còn thiếu: bộ chọn địa chỉ trong luồng sửa (gap mở) | expected_version | KH | Lệch version → 409 | #238 (mở) |
| M10-R-10 | M10 | Quyền hủy | 11Food | Chưa xác nhận: khách hủy, quán từ chối (có lý do). Đã xác nhận chưa pickup: quán hủy có lý do. Đã pickup: theo M07-R-04 | — | KH, CQ | Race hủy vs xác nhận → một bên thắng | M10 §9; M07-owner-delivery-flow |
| M10-R-11 | M10 | Thời hạn ba giai đoạn | — | Chờ quán: nhắc phút 15/20/25, phút 30 SYSTEM hủy. Chờ shipper: ngừng tìm phút 30, phút 60 SYSTEM hủy cả Order. Đã nhận chưa lấy: phút 30 cảnh báo, phút 60 SYSTEM hủy và giải phóng hold. Không cộng dồn giai đoạn; pickup thắng thì không hủy | Policy snapshot lúc INSERT | — | Lỗi phần nào rollback tất cả | M10-timeouts (21/10); #153 |
| M10-R-12 | M10 | Cấu hình thời hạn | Admin `/system/settings/order-timeouts` | Bảy ô phút; lịch sử thay đổi append-only | `order_timeout_policy(_changes)` | SYS hoặc AD có quyền | — | M10-timeouts |
| M10-R-13 | M10 | Log mọi kiểu hủy | — | `cancellation_transitions` append-only; CANCELLED_BY_SYSTEM hiện rõ là hệ thống hủy; hủy bởi Admin hiện là Admin hủy | — | — | — | M10-timeouts; #260 |
| M10-R-14 | M10 | Trạng thái hiển thị | 11Food | Nhãn khách theo bảng §8 (Chờ quán xác nhận … Hoàn thành) | Order và delivery lưu riêng | KH | — | M10 §8 |
| M10-R-15 | M10 | Tiền và đã thanh toán | Chi tiết đơn | Theo dõi tiền món chốt, đã trả, còn phải thu, phí ship và bên trả. Không giữ tiền hàng/COD | — | — | — | M10 §11; #213 → C-08 |
| M10-R-16 | M10 | Đơn hẹn giờ | Checkout | Giờ hẹn là giờ mong muốn nhận món; chọn theo lịch quán; chưa tự gọi shipper theo đồng hồ | — | KH | — | M10 §7 |
| M10-R-17 | M10 | Lý do thiếu phí/khoảng cách | Checkout, chi tiết | Hiện lý do cụ thể khi thiếu khoảng cách/phí | — | KH | — | #211 |
| M10-R-18 | M10 | Đổi địa chỉ sau xác nhận | Chi tiết đơn | Theo luồng #218 | — | KH, CQ | — | #218 |
| M10-R-19 | M10 | Mã đơn hiển thị | Danh sách, chi tiết, thông báo | Dạng K01-0001; mã quán duy nhất, không tái dùng; một dãy số chung cho ORDER và DIRECT của quán; không reset; mã cũ DH-/G- vẫn tìm được; route vẫn dùng UUID | Counter transactional theo quán | — | Không trùng khi đồng thời | M10-M07-filter-shop-code (22/10) |
| M10-R-20 | M10 | Danh sách đơn quán | 11Food Đơn hàng: Đơn món / Giao hàng | Một hàng tìm kiếm + nút Lọc; mặc định Tất cả; lọc và tìm ở máy chủ | `GET /v1/shop/me/orders`, `GET /v1/shop/me/deliveries` | CQ | Lọc rỗng → "Không có đơn phù hợp" + Xóa bộ lọc | M10-M07-filter-shop-code (22/10) |
| M10-R-21 | M10 | Trao đổi đơn hàng | `/v1/customers/me/orders/:id/chat`, `/v1/shop/me/orders/:id/chat`, `/v1/shop/me/deliveries/:id/chat`, `/v1/driver/deliveries/:id/chat` | Một feed gồm tin văn bản và mốc nghiệp vụ; chat không đổi phí/trạng thái; tối đa 500 ký tự; shipper chỉ khi assignment ACTIVE | `order_chat_messages` | Bên liên quan | Không có quyền → 404; đã đóng → 409 ORDER_CHAT_CLOSED | M10-order-chat (25/10); #191 |
| M10-R-22 | M10 | Lưu trữ chat | — | Mặc định 7 ngày từ khi hồ sơ đóng (1–365); giữ chứng cứ khi có khiếu nại hoặc hold | `chat.retention_days` | SYS sửa | Hết hạn → expired:true | M10-order-chat |
| M10-R-23 | M10 | Đơn cũ bất biến `[P8]` | Chi tiết đơn cũ | Quãng đường/phí đơn cũ không đổi (ví dụ K01-0006 giữ 3.838 m). Nếu vẽ tuyến hiện tại cho đơn cũ phải ghi "chỉ tham khảo" | Snapshot | — | — | #294 |

## 11. M11 — Đánh giá và phản ánh

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M11-R-01 | M11 | Điều kiện đánh giá | Chi tiết đơn | Khách → quán khi Order hoàn thành; khách → shipper khi delivery thành công; quán → shipper khi thành công hoặc thất bại. 1–5 sao, một lần, không sửa/xóa | — | KH, CQ | Gửi lặp không tạo bản ghi mới | M11-Functional-UI-LOCKED §1 (16/10) |
| M11-R-02 | M11 | Đánh giá đúng shipper | — | Đánh giá shipper thực sự đã giao | — | — | — | #214 |
| M11-R-03 | M11 | Phản hồi của quán | Trang quán | Một phản hồi mỗi đánh giá, cập nhật có lịch sử; quán không sửa/xóa đánh giá khách | — | CQ | — | M11 §2 |
| M11-R-04 | M11 | Gửi phản ánh | Chi tiết đơn; Tài khoản → Phản ánh của tôi | 6 nhóm; nội dung bắt buộc; tối đa 5 ảnh, 5 MB/ảnh | — | KH, CQ, SP | — | M11 §4 |
| M11-R-05 | M11 | Vòng đời hồ sơ | Admin Web › Phản ánh | Chờ tiếp nhận → Đang xử lý → Chờ bổ sung → Đã giải quyết / Đóng không xử lý (bắt buộc lý do); xem xét lại trong 7 ngày sau đóng | — | AD theo scope | — | M11 §5 |
| M11-R-06 | M11 | Phản ánh không tự đổi tiền/trạng thái | — | Điều chỉnh tiền đi qua M04 với quyền riêng | — | AD (`wallet.adjustment.post`) | Thiếu số dư → M04-R-08 | M11 §7 |
| M11-R-07 | M11 | Scope Admin theo từng hồ sơ | Admin Web | Phân scope SHOP/DRIVER theo từng hồ sơ; shipper SUSPENDED vẫn đọc được phản ánh của mình; có job dọn ảnh mồ côi | — | AD | — | #261 (29/10) |

## 12. M12 — Quản trị, điều hành, báo cáo (Admin Web)

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M12-R-01 | M12 | Chỉ ở Admin Web | Admin Web | M12 tổng hợp và gọi command của module sở hữu, không tạo bản sao nguồn chuẩn | — | SYS, AD | — | M12-spec §1 (16/10) |
| M12-R-02 | M12 | Trạng thái màn hình | Mọi màn | Có loading/empty/error/mất kết nối/thiếu quyền; module chưa sẵn sàng hiện "chưa sẵn sàng", không phải 0 | — | — | Lỗi tải không hiện 0 | M12-spec §2 |
| M12-R-03 | M12 | Quyền ADMIN | M12-C | SYS quản lý ADMIN; ADMIN không tự nâng quyền; quyền app (can_view, can_review_profile, can_lock, can_manage_shops) theo scope SHOP và/hoặc DRIVER | — | SYS | — | M12-spec §3; G03 |
| M12-R-04 | M12 | Cấu hình tập trung | M12-D | Validate → so sánh cũ/mới → lưu có version và audit; chỉ SYS sửa hai công tắc OTP | — | SYS | — | M12-spec §3 |
| M12-R-05 | M12 | Báo cáo và xuất | M12-E | Tiền món/phí ship/nạp ví không phải doanh thu nền tảng; hoa hồng lấy từ ledger M04. Xuất theo đúng bộ lọc và quyền, kiểm cả lúc tạo và lúc tải, chống công thức bảng tính | — | AD (`report.read`, `report.export`) | — | M12-spec §4–5 |
| M12-R-06 | M12 | Nhật ký và sao lưu | M12-F | Audit chỉ đọc. Sao lưu hằng ngày, giữ 7 ngày + 4 tuần, thêm bản trước migration; bản sao ngoài VPS, mã hóa (Google Drive + rclone); khôi phục chỉ SYS | — | AD (`audit.read`); SYS | — | M12-spec §6; M12-implementation (Owner chốt) |
| M12-R-07 | M12 | Scope báo cáo/audit | — | Báo cáo và audit theo scope; wallet.read là quyền riêng | — | AD | — | #262 (29/10) |
| M12-R-08 | M12 | Hàng đợi việc, phân tích, cờ bất thường | Admin Web | Hàng đợi việc cần xử lý; phân tích; cờ bất thường chỉ gắn cờ, không tự xử lý | — | AD | — | #216; #241; #242 |
| M12-R-09 | M12 | Mini Business | PWA `/business/` | Bảng điều khiển cho chủ doanh nghiệp | — | cxđ | — | #236; #237; business-dashboard |

## 13. M13 — Vận hành, cảnh báo, cập nhật

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M13-R-01 | M13 | Sự cố | Admin Web | NEW → ACKNOWLEDGED → IN_PROGRESS → RECOVERED → CLOSED; gộp theo fingerprint; báo Discord | — | SYS; AD được cấp | UNKNOWN/NO_DATA/STALE không bao giờ hiện xanh | M13-implementation (23/10) |
| M13-R-02 | M13 | Không có nút deploy | Admin Web | Chỉ ghi lịch sử deploy và health check | — | — | — | M13-implementation (Owner) |
| M13-R-03 | M13 | Probe bên ngoài | Ngoài VPS | Probe ngoài + Discord là điều kiện nghiệm thu | — | — | — | #264 (29/10) |
| M13-R-04 | M13 | Giám sát VPS | Admin Web | Theo #247 | — | SYS | — | #247 |
| M13-R-05 | M13 | Tương thích APK–backend | `/check` (không cần đăng nhập) | Dưới min_client_version_code → bắt buộc cập nhật; trên mức tối thiểu → khuyến nghị. Shipper đang có đơn chỉ thấy banner | `app-compatibility.json` | — | Check lỗi → thử lại sau 2 phút | M13-apk-backend-compat (25/10) |
| M13-R-06 | M13 | Kênh cập nhật | — | Chỉ kiểm phiên bản + Google Play; giữ đường cập nhật APK cũ trong giai đoạn chuyển tiếp | — | — | — | #280 → C-14 |
| M13-R-07 | M13 | Nhật ký lỗi | Admin Web | Chỉ SYS đọc; không lưu SQL/mật khẩu/token/OTP/số tài khoản/ảnh/địa chỉ khách | — | SYS | — | M13-error-logs (21/10) |

## 14. M14 — GPS, bản đồ, định tuyến

| Req ID | Module | Yêu cầu | Entry point dự kiến | Hành vi mong đợi | State/Data | Quyền | Hành vi khi lỗi | Nguồn |
|---|---|---|---|---|---|---|---|---|
| M14-R-01 | M14 | GPS nền khi Online | 11Ship (foreground service) | GPS nền khoảng 60 s/lần, có thông báo thường trực. Tắt Online thì dừng GPS kể cả khi còn chuyến | `should_share_location` = intent_online và ACTIVE | SP | — | #265 (29/10) → C-07 |
| M14-R-02 | M14 | Độ mới vị trí | — | LIVE ≤ 120 s; STALE ≤ 600 s; shipper Offline không bao giờ vẽ là LIVE | — | — | — | #265; M14-online-location |
| M14-R-03 | M14 | Ngưỡng độ chính xác | — | Bỏ mẫu có sai số > 500 m | — | — | — | #265 |
| M14-R-04 | M14 | Phiên khóa báo vị trí | — | Đăng xuất/thu hồi phiên thì không báo vị trí và không nhận đơn được | — | SP | 401 → dừng dịch vụ | M14-online-location |
| M14-R-05 | M14 | Một cảnh báo đúng nguyên nhân | 11Ship Home | Một vùng đỏ duy nhất theo thứ tự ưu tiên (mất Internet, lỗi máy chủ, lỗi gửi vị trí, tạm dừng do vị trí cũ…) | — | SP | — | M14-home-alerts (25/10); #194 |
| M14-R-06 | M14 | Camera và cử chỉ bản đồ | Bản đồ | Theo #203/#215 | — | — | — | #203; #215 → C-12 |
| M14-R-07 | M14 | Tìm địa điểm offline | Bản đồ | Tìm địa điểm Cao Bằng offline | — | — | — | #283 |
| M14-R-08 | M14 | Không lưu lịch sử GPS chính thức | — | Không lưu chuỗi GPS trên điện thoại hay máy chủ chính thức; chỉ vị trí mới nhất | — | — | — | M10 §17; M14-integration |
| M14-R-09 | M14 | Tracking theo delivery hiện hành | Chi tiết đơn | Bám assignment hiện hành; dừng live khi đơn kết thúc; không giả tọa độ | — | KH, CQ theo quyền | — | M10 §17 |
| M14-R-10 | M14 | Một hợp đồng định tuyến `[P8]` | Routing service (Valhalla) | Tuyến xe máy ngắn nhất hợp lệ; trả distance_m, ETA, geometry, route_version. Không fallback đường thẳng | — | — | Lỗi → ROUTE_DATA_UNAVAILABLE | #294 (01/11); #239 → C-15 |
| M14-R-11 | M14 | Bản đồ vẽ đúng tuyến đã báo giá `[P8]` | Bản đồ checkout/chi tiết đơn | Polyline là chính tuyến đã dùng để tính giá | geometry + route_version | — | — | #294 |
| M14-R-12 | M14 | Vòng 3 km trên Home 11Ship `[P8]` | 11Ship Home | Tâm là GPS shipper, đường thẳng. Bên trong trong suốt, bên ngoài phủ xám; camera vừa 3 km + lề | — | SP | — | #294 → C-12 |

## 15. Ma trận nguồn theo mục Phase 1

Phase 1 dùng các dòng trên làm đầu vào cho:
- **B-00:** script kiểm kê đảm bảo mọi module, route, bảng, route Admin, màn mobile, runner và workflow map vào ít nhất một dòng. Dòng nào không map được thì bổ sung hoặc đánh dấu.
- **B-02:** Codex lập ma trận ánh xạ.
- **B-03:** smoke test.

## 16. Conflict Register (B-05)

Mỗi xung đột cần Owner quyết. Cột **Đề xuất** chỉ là gợi ý theo thứ tự ưu tiên nguồn, chưa có hiệu lực.

| ID | Chủ đề | Nguồn A | Nguồn B | Đề xuất của Lead |
|---|---|---|---|---|
| C-01 | Rút tiền khi bị khóa | M01-final-package: shipper bị khóa được yêu cầu rút, tối thiểu 10.000 đ | #255: chỉ rút khi CLOSING, không có mức tối thiểu | Theo #255 (OWNER LOCK, mới hơn) |
| C-02 | Điều kiện rút tiền | M04-C: rút tối thiểu 10.000 đ, ngân hàng phải VERIFIED, cần ≥100k đã nạp | M03-simplified + #255 | Theo #255; đánh dấu M04-C lỗi thời |
| C-03 | Bán kính tìm shipper | M03-UI-LOCKED, M06-design: 5 km | M06-v1.1: 3 km | 3 km (M06-v1.1, mới hơn) |
| C-04 | Xác minh ngân hàng là điều kiện nhận đơn | M06-BC | #257, M03-simplified | Bỏ điều kiện (theo #257) |
| C-05 | Khoảng cách trên trang khám phá | M02-discovery 16/10: không hiện khoảng cách; #147: Haversine; #206: chỉ đường đi | #294: quán → GPS hiện tại (ngược chiều với code hiện tại) | Theo #294 (Owner 01/11) |
| C-06 | Quyền ghi nhận thanh toán quán | business-dashboard: dùng wallet.topup.record | G03: shop.payment.* | Theo G03 |
| C-07 | GPS khi còn chuyến | M14-online-location 24/10: còn chuyến vẫn giữ GPS | #265: tắt Online là dừng GPS | Theo #265 (đã ghi rõ thay thế) |
| C-08 | Hiển thị đã trả/còn phải thu | #213: hiện | M07 23/10: bỏ khỏi UI | Owner quyết |
| C-09 | Giới hạn chat tài chính | #199: 1000 ký tự | G03: 500 grapheme | 500 grapheme (G03) |
| C-10 | Bước "món sẵn sàng" | M10 §6: hai thao tác độc lập | M07 23/10: bỏ bước ready | Theo M07 23/10 |
| C-11 | DIRECT do quán tạo | M07 23/10: có DIRECT do quán tạo | #221: bỏ DIRECT độc lập của quán | Owner quyết |
| C-12 | Camera bản đồ | #203: khoảng 5 km | #294: vừa 3 km | Theo #294 cho Home 11Ship |
| C-13 | Điều khoản | terms v1 / privacy v1 | Bản nháp v2 (31/10) | Giữ v1 tới khi Owner duyệt v2 |
| C-14 | Kênh cập nhật | #280: chỉ kiểm phiên bản + Google Play | Giữ đường APK cũ khi chuyển tiếp | Giữ cả hai trong giai đoạn chuyển tiếp |
| C-15 | Trạng thái routing Valhalla | #239 đã đóng nhưng routing chưa deploy, M14_ROUTING_ORIGIN chưa đặt | Comment #238 (31/10): Valhalla chạy trên VPS | Kiểm runtime ở Phase 6, ghi NOT TESTED đến khi có bằng chứng |

## 17. Câu hỏi mở cho Owner

1. Xác nhận các đề xuất trong Conflict Register; riêng C-08 và C-11 cần Owner quyết.
2. M10-R-09: bộ chọn địa chỉ trong luồng sửa đơn (#238) có thuộc baseline hiện tại không?
3. M12-R-09: quyền truy cập Mini Business `/business/` dành cho ai?
4. Các dòng `[P8]` (#294, #295) giữ nguyên là lỗi cần sửa ở Phase 8, không mở thành tính năng mới.

## 18. Phản biện tiếp theo

- **Codex:** kiểm từng dòng với nguồn, chỉ ra dòng thiếu/sai, lập B-02.
- **Antigravity:** phản biện chéo module, nhất là luồng M10↔M07↔M04↔M14.
- **Owner:** xác nhận ở B-04.
