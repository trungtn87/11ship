# Đối chiếu mã nguồn ↔ test case, và những phần chưa xác minh

Tài liệu này cho biết: **chức năng nào thật sự có trong code** (đã đọc trực tiếp), **test case nào kiểm chức năng đó**, **phần nào chưa có / chưa đủ bằng chứng**, và **chỗ nào tài liệu nghiệp vụ khác với code**.

- Mã nguồn đã đối chiếu: nhánh `main`, commit `{{COMMIT}}` (24/10/2026). Nhánh làm việc trùng đúng commit này.
- Khi code và tài liệu khác nhau, **code (hành vi đã đọc được) được coi là sự thật**; chỗ lệch được ghi ở mục 4 để Owner quyết định.
- Tuyệt đối không suy đoán chức năng chưa tìm thấy bằng chứng: phần đó nằm ở mục 3 với nhãn **NOT READY** hoặc **CẦN XÁC MINH**.

## 1. Cách đối chiếu và mức bằng chứng

| Nguồn đã đọc | Nội dung |
|---|---|
| `mobile/food`, `mobile/ship`, `mobile/packages/n11_shared` | Toàn bộ màn hình, nút, thông báo tiếng Việt của hai ứng dụng (Dart, {{DART_LIB_FILES}} file mã) |
| `apps/admin-web/src` | {{ADMIN_VIEWS}} màn hình Web Admin và `core/menu.ts` (menu và quyền) |
| `apps/backend/src` | {{BACKEND_MODULES}} module (đơn hàng, giao hàng, ví, phí, thông báo, quản trị…), {{CONTROLLERS}} controller |
| `database/migrations` | {{MIGRATIONS}} migration (cấu trúc dữ liệu) |
| `docs/current/*.md` | {{DOCS_CURRENT}} tài liệu nghiệp vụ; **ưu tiên bản mới nhất** (M07 23–24/10/2026, M10 timeouts 21/10, M03 20/10, M14 24/10) |
| `tests/`, `mobile/**/test` | Bộ kiểm thử tự động hiện có ({{INT_SPECS}} tệp tích hợp, {{UNIT_SPECS}} tệp unit backend, {{ADMIN_SPECS}} tệp Admin Web, {{FLUTTER_TESTS}} tệp Flutter) |

Mức bằng chứng trong bảng ở mục 2: **CODE** = đã đọc mã giao diện/backend; **DOC** = chỉ có tài liệu; **TỰ ĐỘNG** = có kiểm thử tự động đối chiếu; **MÁY THẬT** = chỉ kiểm được trên thiết bị thật.

## 2. Bảng đối chiếu chức năng ↔ test case

{{COVERAGE_TABLE}}

## 3. Chức năng chưa có, chưa hoàn thành hoặc chưa đủ bằng chứng

Mỗi dòng đều **có test case** (không bỏ qua), để ghi nhận hiện trạng.

{{GAPS_TABLE}}

### 3.1 Điều kiện môi trường mà người kiểm thử mới **không tự tạo được**

| Điều kiện | Vì sao | Ai làm | Test bị ảnh hưởng nếu thiếu |
|---|---|---|---|
| Tài khoản **SYSTEM** | Không có đường tạo trên giao diện; do công cụ trên máy chủ | Kỹ thuật viên | Mọi test cần SYSTEM (TC-ADM-002/004…, cấu hình, phí, hoa hồng) |
| **SMS Gateway** (điện thoại gửi OTP) + danh sách số được phép nhận SMS | OTP chỉ đi qua máy này; mặc định chỉ số trong danh sách trắng nhận được | Kỹ thuật viên/Owner | TC-ACC-001…013, TC-ADM-005/011 |
| **Bảng phí giao** do SYSTEM áp dụng; **dịch vụ tuyến** | Thiếu thì phí "Chưa xác định phí" | SYSTEM/Kỹ thuật viên | TC-CUS-021, TC-FLOW-* |
| **Tiền thử nghiệm** trong ví shipper | Chỉ Admin ghi nhận được; mỗi ghi nhận là bút toán thật | Owner duyệt + Admin | TC-WAL-005 và mọi test shipper nhận đơn |
| **Thông báo đẩy (Firebase)** | Cần khóa dịch vụ và APK có hỗ trợ push | Kỹ thuật viên/Owner | TC-NOTI-001, TC-FLOW-023 (phần màn hình khóa), TC-ABN-014 |
| **Gói bản đồ Cao Bằng** trong APK | Cờ build `M14_OFFLINE_MAP` | Kỹ thuật viên | TC-DRV-018, TC-CUS-027 (ghim bản đồ) |
| **Hai bản APK** (cũ và mới) / bản phát hành trong Web Admin | Thử cập nhật đè và cập nhật trong ứng dụng | Kỹ thuật viên | TC-SET-007/008/009/010 |
| Người **đứng ngoài khu vực phục vụ** / **cách quán > 3 km** | Ứng dụng từ chối vị trí giả | Người kiểm thử có điều kiện | TC-CUS-003, TC-SHOP-004, TC-DRV-008 |
| Làm **chậm/ngừng máy chủ**, rút ngắn **thời hạn tự hủy** | Cấu hình hạ tầng | Kỹ thuật viên/SYSTEM | TC-ABN-009, TC-FLOW-005/012/029 |

## 4. Chỗ tài liệu khác với mã nguồn (cần Owner quyết định)

| # | Tài liệu nói | Mã nguồn thực tế | Cách bộ test xử lý |
|---|---|---|---|
| 1 | `README.md` và `docs/PROGRESS.md`: "Chưa có Wallet, Delivery, frontend, SMS…", tiến độ dừng ở M00-D1, "CI main: Lỗi" | Code đã có M01–M14: đơn hàng, giao hàng, ví, thông báo, đánh giá, Admin Web, ứng dụng Android | **Không dùng README/PROGRESS làm nguồn trạng thái.** Test viết theo code và `docs/current` mới nhất |
| 2 | Checklist Owner M07/M10 (18–19/10): có bước **"Món đã sẵn sàng"**, **"Giao thất bại"**, **"Ghi nhận thanh toán"**, "Đã thanh toán/Còn phải thu" | M07 23/10 **bỏ** "Món đã sẵn sàng", shipper **không còn** "Giao thất bại", UI **bỏ** dòng thanh toán; endpoint `.../ready` chỉ giữ để APK cũ không lỗi | Test **theo quyết định mới** (TC-DRV-015, TC-SHOP-022, TC-CUS-025). Test kiểm cả việc các nút cũ **không còn** |
| 3 | Bán kính tìm shipper: M07 ghi 5 km | M06 v1.1 (18/10) khóa **3 km** | Dùng 3 km (TC-DRV-008) |
| 4 | Màn đăng ký chủ quán: "Chỉ bán hàng **sau khi được duyệt**"; Admin Điều hành có thẻ "Hồ sơ quán/shipper **chờ duyệt**" | Quán ACTIVE ngay khi hồ sơ đủ; shipper ACTIVE ngay khi đăng ký (M03 20/10); Admin chỉ có Vô hiệu hóa/Kích hoạt lại | TC-ADM-015 (ghi nhận hiện trạng), TC-ADM-019 (CẦN XÁC MINH); câu hỏi OQ-01 cho Owner |
| 5 | Điều khoản hiển thị cho người dùng: "đặt món, giao hàng, ví và doanh thu **chưa hoạt động**; quyền chỉ có sau khi hồ sơ được duyệt" | Các chức năng này **đã hoạt động** | TC-ACC-029 (báo mức CAO; Owner duyệt/sửa điều khoản và đổi phiên bản) |
| 6 | Chính sách quyền riêng tư: "ứng dụng không theo dõi vị trí nền" (nói về hồ sơ quán) | 11Ship chia sẻ vị trí **nền** khi online (M14) | TC-SEC-007 (CẦN XÁC MINH) |
| 7 | `docs/current/M01-production-profile`: "xóa/khóa USER phải duyệt lại khi có đơn/ví" | Đã có kiểm tra "Không thể khóa lúc này: còn đơn đang xử lý" (M01 final) | TC-ADM-013, TC-ACC-027 |
| 8 | Trang chủ Web Admin: "Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau" | Nhiều chức năng đã có | TC-ADM-034 |
| 9 | Màn Chẩn đoán kết nối có "Phiên bản" | Không có đường vào từ Tài khoản (cả hai app) | TC-SET-006 dùng Cài đặt Android; OQ-04 cho Owner |
| 10 | M10 (19/10): "chưa có bản đồ trong 11Food; M10 chưa hoàn tất" | Đã có `food_m14.dart` (bản đồ chỉ-bản-đồ) nếu APK build có cờ | TC-CUS-027, TC-DRV-018 (CẦN XÁC MINH theo bản APK) |
| 11 | M08 (18/10): "APK bàn giao hiện chưa có push" | Không rõ bản đang thử đã có push | TC-NOTI-001 (CẦN XÁC MINH) |
| 12 | `docs/PROGRESS.md` ghi CI main có thể FAIL | Không kiểm được từ kho mã | Kỹ thuật viên xem CI đúng commit (TC-AUTO-001…007), nhưng **không dùng CI xanh để nghiệm thu** |
| 13 | Tải lại trang con Web Admin (F5) | Có thể 404 (SPA_ROUTES thiếu) – `M02-admin-shops-20261024.md` | Ghi ở "hạn chế đã biết" của hướng dẫn |
| 14 | `mobile/README.md` (mục "Device proof"): điện thoại không có TEE/StrongBox, đã root hoặc bootloader mở sẽ nhận `DEVICE_PROOF_UNSUPPORTED`, không có phương án thay thế | `docs/current/M01-password-sessions-20261023.md` (Owner 23/10, PR #170): đăng ký/đăng nhập thường dùng số điện thoại + mật khẩu, KHÔNG gọi attestation; Keystore chỉ mã hóa token trên máy. Phiên cũ (APK cũ) vẫn giữ kiểm tra thiết bị cho tới khi đăng nhập lại. Mã lỗi `DEVICE_PROOF_*` vẫn còn trong ứng dụng chỉ để tương thích | **Không dùng README cũ để khẳng định máy root/bootloader mở bị chặn.** TC-SET-011, TC-ABN-017 viết lại theo hành vi mới; TC-ACC-025/ABN-020 theo "mỗi tài khoản một phiên". Việc dọn `mobile/README.md` là của nhóm phát triển (không thuộc gói này) |

## 5. Phân loại test case

| Loại kiểm thử | Ý nghĩa | Số test |
|---|---|---|
{{LOAI_ROWS}}

**Kiểm thử tự động đã có (chỉ để đối chiếu, KHÔNG thay thế thử tay):**

| Nhóm rủi ro | Bộ kiểm thử tự động (đường dẫn) | Ghi chú giới hạn |
|---|---|---|
| Đăng ký, OTP, phiên, thiết bị | `tests/integration/auth-*.int.spec.ts`, `client-auth-*`, `native-*`, `account-*`; `mobile/packages/n11_shared/test/session_controller_test.dart`, `otp_flows_test.dart` | Dùng nhà cung cấp OTP giả; không kiểm SMS thật, không kiểm máy thật |
| Quán, thực đơn, giờ mở, khu vực | `shop-*`, `menu.int.spec.ts`, `discovery.int.spec.ts`, `shop-service-areas.int.spec.ts`; Flutter `m02_*_test.dart` | Không có GPS thật |
| Đặt hàng (M10) | `m10-orders.int.spec.ts`, `m10-admin-orders.int.spec.ts`; Flutter `m10_orders_test.dart`, `one_page_order_test.dart` | Không kiểm 2–3 người thật và thông báo thật |
| Giao hàng (M07), phí (M06) | `m07-delivery.int.spec.ts`, `m06-*.int.spec.ts`; Flutter `m07_*_test.dart`, `m06_views_test.dart` | Dịch vụ tuyến là máy chủ cục bộ giả |
| Ví (M04) | `m04-*.int.spec.ts`; Flutter `wallet_*_test.dart` | Không có ngân hàng thật; đối soát chạy trên dữ liệu thử |
| Thông báo (M08), đánh giá/phản ánh (M11) | `m08-*.int.spec.ts`, `m11-*.int.spec.ts`; Flutter `m08_test.dart`, `m11_test.dart` | Push dùng nhà cung cấp giả |
| Web Admin | `admin-*.int.spec.ts`, `m12-*`, `m13-*`; `apps/admin-web/src/**/*.spec.ts` | Có kiểm bằng trình duyệt tự động nhưng không phải quy trình người dùng thật |
| Chống trùng, outbox, giao dịch, nâng cấp CSDL | `idempotency-*`, `outbox-*`, `transaction/*`, `migration.int.spec.ts`, `staging-db-upgrade-from-42.int.spec.ts` | Kiểm đúng kỹ thuật, không kiểm hành vi người dùng |
| Dịch vụ nền Android | `mobile/ship` (LocationReporterTest JVM), `mobile/gateway/test` | **Không chứng minh dịch vụ chạy ổn trên máy thật** (tài liệu M14 tự nêu) |

Tài liệu M07/M10/M14 tự ghi "chưa kiểm trên thiết bị thật". Vì vậy **mọi test P0 đều phải chạy trên máy thật** dù đã có kiểm thử tự động tương ứng.

## 6. Tự kiểm tra bộ test case (kết quả thực tế khi tạo tài liệu)

{{SELF_CHECK}}

## 7. Giới hạn của lần đối chiếu này

- Không chạy ứng dụng thật hay máy chủ thật; mọi tên nút, thông báo và kết quả mong đợi lấy từ **mã nguồn và tài liệu**. Nếu ứng dụng thật hiển thị khác (đổi chữ, thiếu nút), người kiểm thử ghi lại bằng chứng và gửi Owner; **đó là phát hiện, không phải lỗi của test**.
- Không xác minh được: trạng thái triển khai máy chủ thật, cấu hình Firebase, danh sách SMS được phép, bảng phí đang áp dụng, dữ liệu đã có trên máy chủ.
- Màn hình Web Admin được mô tả theo mã (menu, nhãn, thông báo); bố cục thật có thể khác.
- Các tên nhóm món ("Món chính", "Đồ uống"), tên quán/món/tài khoản test là **dữ liệu do bộ test đặt ra**, không có sẵn trong hệ thống.
