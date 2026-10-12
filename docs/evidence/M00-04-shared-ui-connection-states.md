# M00.04 — bằng chứng: bộ UI chung, brand và trạng thái kết nối

Ngày: 12/10/2026 (Asia/Ho_Chi_Minh). Người thực hiện: Claude. Thiết kế: M00 v2.1, gói M00.04 (handoff v2.0.1). Trạng thái: **ĐÃ CODE; KIỂM THỬ KỸ THUẬT CỤC BỘ ĐÃ CHẠY (client-shell 94/94); LINT, TYPECHECK ĐÚNG PHIÊN BẢN GHIM VÀ SPEC BACKEND THẬT CHỈ CHẠY ĐƯỢC Ở CI; OWNER TEST CHƯA CHẠY; REVIEW CHƯA CÓ**.

- Phụ thuộc: M00.03 đã review PASS và merge qua PR #69 (merge commit `40ddfbefad1217538fc7a63228aaf07c4aff5d37`, đã kiểm là tổ tiên của `main`).
- Base của nhánh `feat/m00-04-shared-ui-connection-states`: `main` = `6d597b9e459b5e6b4350fb4b369ac073b614a431`.
- Final SHA và CI đúng final SHA: ghi trong mô tả Draft PR (một file trong PR không thể chứa SHA của chính commit chứa nó).
- Nguồn thiết kế: gói M00.04, `01-m00.md`, `03-ui-catalog.md`, `04-data-api.md` chỉ có trên nhánh PR #48 (head `f135f45`), **chưa nằm trên `main`**. Code bám hợp đồng đó; cần ChatGPT/Owner xác nhận đó là bản đã duyệt.

## Đối chiếu quyết định đã chốt

- Một Web Admin và hai app Android: 11Food (khách + quán), 11Ship (xế). Theo `01-m00.md`, bản web PC của Food/Ship là **runtime thử** của app Android; runtime native chọn sau. Trên `main` **không có Flutter/native**. Gói này không chọn lại công nghệ và không tạo bản web thay thế; nó đặt bộ UI chung vào đúng chỗ runtime thử đang có. Cần xác nhận lại điều này.
- `apps/client-shared` trong handoff là đường dẫn dự kiến; trên `main` đã tồn tại đúng thư mục này, nên **không tạo kiến trúc song song**.

## Mapping trước khi sửa (trên main)

| | Trên main |
|---|---|
| ĐÃ CÓ | `apps/client-shared` (router, ScreenDef/ScreenEnv, thành phần UI, `public/components.css`, tokens), `apps/food-web`, `apps/ship-web`, `apps/ui-foundation`, build `scripts/client-web-build.mjs` (+ `build-manifest.json`), bản xem thiết kế (`design/`), tokens vàng `#D8AD18` / đen `#2A2A2E` / trắng, font đóng gói local kèm giấy phép OFL, navigation/loading/empty/toast đã có; backend `GET /v1/health/live` và `/v1/health/ready` (503 khi DB lỗi) |
| THIẾU | Logic kiểm tra health phía client (timeout 5 s, kiểm body, không cache, generation guard); banner kết nối; màn Chẩn đoán (F05 Food / S06 Ship); mẫu Banner kết nối (F06); nội dung lỗi tiếng Việt đã sanitize; đọc thông tin bản dựng; test cho các điều trên; **file logo gốc của Owner** |
| TÁI SỬ DỤNG | Router/ScreenDef, `listItem`, `icon`, toast, `c-kv`, tokens và font hiện có; khung `build` + `build-manifest.json`; khung test client-shell (`node:test` + Chromium) và quy ước CDP của `tests/integration/support/cdp.ts`; khung integration Nest + PostgreSQL |

## Đã làm (chỉ M00.04; không đụng backend, đăng nhập, ví, đơn hàng, GPS, deploy, migration remote)

**Mapping cấu trúc**: toàn bộ code mới nằm ở `apps/client-shared/src` (dùng chung cho Food và Ship); hai app chỉ thêm một mục vào Tài khoản và một màn trong danh sách.

| Tệp | Vai trò |
|---|---|
| `errors.ts` | Nội dung tiếng Việt cố định cho từng trạng thái; `sanitizeDiagnosticText` |
| `health.ts` | `HealthMonitor`: gọi `live` rồi `ready`, timeout 5 s mỗi yêu cầu, `no-store`, không credentials, kiểm body chặt, generation guard, polling 30 s |
| `environment.ts` | Đọc và kiểm `build-manifest.json` (ứng dụng, chế độ, commit, fingerprint) |
| `connection.ts` | `ConnectionView` (trực tiếp hoặc ví dụ cố định cho bản xem thiết kế); `diagnosticsReport` |
| `connection-ui.ts` | Banner kết nối (DOM bền, không mất focus khi đổi trạng thái) |
| `screens/diagnostics.ts` | Màn Chẩn đoán kết nối, sáu biến thể |
| `app.ts`, `screen.ts` | Gắn monitor và banner cho mọi màn; sự kiện offline/online/visibility |
| `design/*` | Ví dụ cố định và màn mẫu F06 cho bản xem thiết kế (không gọi máy chủ) |
| `public/components.css` | Kiểu banner/chẩn đoán; công tắc có vùng chạm 44px (không đổi hình dạng) |

**Trạng thái**: đang kiểm tra / sẵn sàng / backend chưa ready (`live` ok, `ready` 503) / offline / timeout / phản hồi sai. Nút **Thử lại** chạy một lần kiểm tra mới và bỏ kết quả cũ. Banner ẩn khi sẵn sàng.

**Không có dữ liệu nghiệp vụ giả**: bản chạy thật không hiển thị số liệu mẫu nào; ví dụ cố định chỉ có ở bản xem thiết kế và được gắn nhãn "Dữ liệu minh họa".

## Mapping yêu cầu -> sửa -> test

| Yêu cầu | Sửa | Test |
|---|---|---|
| `live` -> `data.status=ok`; `ready` -> `data.status=ready` hoặc HTTP 503 | `health.ts` (`isHealthBody`, `probe`, `derivePhase`) | `health.test.mjs`: live/ready đạt, body sai nhiều kiểu, HTTP khác, body quá lớn; spec tích hợp backend thật (CI) |
| Timeout 5 giây | Deadline mỗi yêu cầu (AbortController + Promise.race) | `health.test.mjs`: timeout, bỏ qua abort, body treo, `ready` timeout; trình duyệt: timeout khoảng 5 s |
| Không cache health | `cache:'no-store'`, `credentials:'omit'`, `referrerPolicy:'no-referrer'` | `health.test.mjs` kiểm tùy chọn yêu cầu; trình duyệt: máy chủ gửi `Cache-Control: public, max-age=3600`, ứng dụng vẫn hỏi lại, không cookie/Authorization/referrer |
| Generation guard | Sau mỗi probe so `generation`; `markOffline`/`stop`/`check` mới vô hiệu hóa lần cũ | `health.test.mjs`: câu trả lời cũ của `live` và `ready`, `markOffline`, `stop`; trình duyệt: phản hồi chậm cũ không ghi đè |
| Offline | Lỗi mạng -> OFFLINE; sự kiện `offline` của trình duyệt | `health.test.mjs`; trình duyệt: ngắt kết nối, sự kiện offline/online, 4 độ rộng |
| Retry | `check()` mới, nút Thử lại | `health.test.mjs`; trình duyệt: `aria-disabled`, giữ focus, "Đang kiểm tra…" |
| Nội dung lỗi tiếng Việt đã sanitize | Danh sách lý do đóng; chuỗi cố định; `sanitizeDiagnosticText` | `health.test.mjs`: không lộ ngoại lệ thô, secret, token, JWT ngắn, URL có userinfo; spec backend thật: chuỗi kết nối DB không lọt vào kết quả/báo cáo (CI) |
| Navigation, loading, empty, banner, diagnostics dùng chung | Mọi màn có banner; màn Chẩn đoán qua Tài khoản; mẫu F06 | trình duyệt: Food và Ship, luồng Tài khoản -> Chẩn đoán -> Quay lại |
| Chiều rộng 360/390/430 và PC 1366 | CSS banner/chẩn đoán co giãn, không tràn ngang | trình duyệt: 4 độ rộng cho Food (mọi ca lỗi) và Ship |
| Keyboard, focus, accessibility | `role=status` + `aria-live=polite`, `aria-disabled`, focus fallback về h1 | trình duyệt: thứ tự Tab, vòng focus, Enter, dữ kiện a11y |
| Vùng chạm tối thiểu 44px | Mọi điều khiển mới >= `--tap-min`; công tắc cũ (28px) nay 44px | trình duyệt: đo kích thước điều khiển; so điểm ảnh Ship Home/Orders với `main` trùng khớp |
| Backend thật cho bằng chứng kết nối | Spec `tests/integration/client-health.int.spec.ts` (Nest + PostgreSQL) | **CI** (không chạy được cục bộ); test trình duyệt dùng máy chủ health giả có kiểm soát, chỉ để gây lỗi |
| Giữ hồi quy launcher M00.02/M00.03 | Không sửa launcher | `launcher.test.mjs` và bộ PowerShell chạy ở CI |
| Không dữ liệu nghiệp vụ giả | Không thêm mẫu vào bản chạy thật | trình duyệt: bản xem thiết kế không phát yêu cầu mạng; bản chạy thật chỉ gọi health và manifest |

## Kiểm thử đã chạy cục bộ (kỹ thuật, không phải Owner test)

Môi trường: Node v22.22.0 (repo ghim 24.21.0), Chromium 1194 có sẵn, TypeScript **6.0.3** (repo ghim 5.9.3), npm registry không tới được, không có PowerShell.

| Việc | Kết quả |
|---|---|
| `node --test "tests/client-shell/*.test.mjs"` (`CLIENT_WEB_TSC`, `CHROME_BIN` đặt tay) | **94 pass, 0 fail, 0 skip** (gồm 32 test logic và 35 test trình duyệt mới của M00.04; các test cũ giữ nguyên) |
| Mutation: phá từng cơ chế (generation guard, timeout, no-store, kiểm body, sanitize...) | Test đỏ đúng chỗ; các mutant còn sống ban đầu đã dẫn tới việc đặt generation guard làm cơ chế duy nhất và thêm test |
| Emit CJS cho spec tích hợp | Biên dịch được |
| So điểm ảnh Ship Home/Orders với `main` | Trùng khớp (công tắc đổi vùng chạm, không đổi hình) |

## Ảnh trạng thái UI thực tế

26 ảnh JPEG chụp từ Chromium headless ở `docs/evidence/M00-04/img/` (tên `<app>-<độ rộng>-<màn>.jpg`). Là bản chụp **bản web PC dùng làm runtime thử**, không phải ảnh điện thoại thật.

| Nhóm | Ảnh |
|---|---|
| Food, Chẩn đoán sẵn sàng | `food-360/390/430/1366-diagnostics-ready` |
| Food, banner backend chưa ready | `food-360/390/430/1366-banner-backend-not-ready` |
| Food, offline | `food-360/390/430/1366-diagnostics-offline`, `food-390-banner-offline` |
| Food 390, các ca khác | `banner-bad-response`, `diagnostics-checking`, `diagnostics-timeout`, `diagnostics-bad-response`, `diagnostics-status-500`, `banner-focus`, `diagnostics-copy-fallback` |
| Ship | `ship-390-diagnostics-ready`, `ship-390-home-not-ready`, `ship-390-home-offline`, `ship-360/430/1366-home-offline` |

## Chưa chạy / BLOCKED

- `npm run lint`, `typecheck` với TypeScript 5.9.3, `test:unit`, `test:integration` (gồm `client-health.int.spec.ts` với backend + PostgreSQL thật), bộ PowerShell của launcher: không chạy được cục bộ; **CI là bằng chứng chính thức** trên final SHA.
- **Owner test trên máy tính và điện thoại: CHƯA CHẠY.** Chưa có kết quả thật nào.
- Runtime Android/native: không thuộc gói này.

## Giới hạn và câu hỏi mở cho review

1. **Runtime**: trên `main` không có Flutter/native; code dùng runtime thử TypeScript web đã duyệt ở `01-m00.md`. Xin xác nhận.
2. **Logo**: chưa có file logo gốc của Owner (`apps/client-shared/public/brand/`). Giữ tên ứng dụng dạng chữ (`data-logo-placeholder`); **không tự thiết kế logo thay thế**. Cần Owner cung cấp asset.
3. **Mẫu đã duyệt**: không có ảnh mẫu F05/F06/S06; triển khai từ dòng catalog. Owner cần xem ảnh ở trên.
4. **Tên môi trường DEV/TEST** không hiển thị (client không biết); màn chẩn đoán hiện địa chỉ thay thế.
5. **Tham số**: polling 30 s và timeout 5 s mỗi yêu cầu (tối đa 10 s cho một lần kiểm tra đủ hai yêu cầu) là lựa chọn thiết kế cần xác nhận.
6. **Bản chạy thật cần proxy `/v1`** cùng nguồn; đến khi có M00.05, mở bản build bằng máy chủ tĩnh sẽ hiện "Máy chủ phản hồi chưa đúng" (HTTP 404). Đây là hành vi đúng.
7. **TypeScript** cục bộ 6.0.3 khác bản ghim 5.9.3; CI quyết định.
8. **CSS dùng chung**: công tắc đổi vùng chạm 28 -> 44px (hình và bố cục giữ nguyên, đã đo điểm ảnh).
9. Không đóng #50 và không đóng toàn bộ M00; không sang M00.05.

| Cổng | Trạng thái |
|---|---|
| Code theo hợp đồng thiết kế (phần đủ hợp đồng) | XONG (chờ review) |
| Test kỹ thuật cục bộ (client-shell) | ĐÃ CHẠY, 94/94 |
| CI trên đúng final SHA | xem mô tả PR |
| Owner test trên PC | **CHƯA CHẠY** |
| Owner test trên điện thoại | **CHƯA CHẠY** |
| ChatGPT review | CHƯA CÓ |
