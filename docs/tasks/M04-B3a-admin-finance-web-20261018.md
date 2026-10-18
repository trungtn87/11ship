# 11Ship — M04-B3a: Web Admin Tài chính (UI tích hợp nạp tiền thật)
Ngày giao: 18/10/2026. **CODE_READY / CLAUDE HANDOFF** — triển khai PR riêng, review + Owner duyệt trước merge. **Không deploy VPS, không migrate production.**

Repo `trungtn87/11ship`. B2.2b đã merge ở PR #132 (merge commit `71d2e2a0957db1bcbfb8cad30c81ffa3e708cd03`). Checkout **main mới nhất** rồi mới làm. UI tham khảo được Owner duyệt tại `docs/ui/m04/README.md` (M04-A03/A04). B3a là **Web Admin**; B3b nối app 11Ship/Shipper nạp tiền thành PR riêng. Không triển khai màn rút tiền, ledger/đối soát tổng, tổng quan số dư hoặc tiền hoa hồng khi chưa có backend thật.

## 0. Preflight bắt buộc: code thực và hợp đồng API
Đọc chỉ các file cần thiết:
- `apps/admin-web/src/core/{finance.ts,finance-controller.ts,menu.ts,routes.ts,api.ts,shippers-api.ts}`, `apps/admin-web/src/dom/{finance-view.ts,shell-app.ts,main.ts,shippers-view.ts}`, `apps/admin-web/src/design/*` (để biết chỉ là mockup), tests admin-web; `docs/brand/README.md`.
- `apps/backend/src/{admin-topups/admin-topup.controller.ts,admin-topups/admin-topup-validation.ts,finance-access/finance-access.controller.ts,finance-access/finance-access-service.ts,finance-access/system-bank-account-service.ts}`, `docs/current/M04-B2-2b-admin-topup-posting-20261018.md`, ADR-003/ADR-004 §5/§9.
- Kiểm tra main/PR đang mở để không đụng đồng thời code cùng vùng với PR khác. Không viết lại nghiệp vụ giao dịch tiền đã merge, không sửa migration.

**Hiện trạng thực đã xác nhận 18/10:** UI tài chính có sẵn `FinanceSource = NOT_WIRED_FINANCE`, `FinanceController`, `FinanceView`, routes `/finance/topups`, `/finance/topups/:id`, nhưng chỉ placeholder, disabled; `dom/main.ts` còn truyền `undefined` vào tham số finance của `ShellApp`. Menu Finance của ADMIN hiện lấy `admin_app_permissions` nên mặc định không hiện ngay cả khi đã có `wallet.read`/ `wallet.topup.record`. **Không** biến mock design/sample thành dữ liệu production.

## 1. Slice B3a — các màn nối API thật
### A. Quyền tài chính (mọi phiên ADMIN/SYSTEM)
- Trên mount, GET `/v1/admin/finance/access/me`: payload `{role, implicit, permissions: string[]}`. Phân quyền UI riêng `wallet.read`, `wallet.topup.record`; SYSTEM quyền ngầm. KHÔNG suy từ `can_view`, `driver`, sidebar cũ hay role của Shipper. ADMIN không grant → không xem hoặc ghi. Có record mà không read → không hiển thị dữ liệu/danh sách; hướng dẫn SYSTEM cấp thêm `wallet.read` nếu muốn thao tác qua giao diện. Nếu read mà không record → read only.
- Quyền 403 khi vào trực tiếp URL, khi reload hay sau revoke → xóa nội dung nhạy cảm, tải lại `access/me`; 401 logout theo auth hiện hành. Menu hiển thị mục Nạp tiền cho ADMIN có `wallet.read`, không lộ route tài chính khác; chỉ SYSTEM được quản lý tài khoản nhận tiền và cấp quyền. Server quyết định quyền thực tế.
- Không đánh dấu `ready` hoặc `wired` cho M04-A01/A02/A05/A06 mà không có API. Màn legacy khác giữ not-wired/disabled rõ ràng; không dựa vào cờ `FinanceSource !== NOT_WIRED_FINANCE` để mở toàn bộ chức năng khi mới nối topups.

### B. Danh sách nạp (M04-A03)
- `GET /v1/admin/finance/topup-requests?status&limit&cursor`, trả `{data:{items:[{request_id,driver_id,amount_requested_vnd,actual_amount_vnd,state,version,created_at,resolved_at,received_at}],next_cursor}}`.
- Phân trang **cursor server**, 1..50 (khuyên 20); tab Chờ = `PENDING`, Đã xử lý = `CONFIRMED/REJECTED/CANCELLED` (backend chỉ nhận một status/lần: nếu không có truy vấn hợp nhất, hiển thị tất cả + nhóm client **chỉ trên các trang đã tải** hoặc đổi tab thành trạng thái trực tiếp; không tự gọi nhiều status rồi tuyên bố có tổng). Tổng đếm, search tên/SĐT hoặc biểu đồ không có trong response → không bịa/không hiển thị tổng toàn hệ thống. Nếu chỉ có driver_id, hiện mã rút gọn/mã đầy đủ khi mở, không suy ra tên/SĐT.
- Bảng ưu tiên thời gian, mã yêu cầu, driver ID, tiền đề nghị, tiền thực nhận (nếu CONFIRMED), trạng thái, xem chi tiết. Empty/loading/403/404/network/retry đúng; tiền VND nguyên và thời gian theo múi giờ giao diện; sanitize all text.
- Không dùng lọc client-only trên 20 mục mà giả là tìm kiếm toàn hệ thống. `DONE` tab của mockup không có backend status tương ứng; UI phải điều chỉnh nhãn/mapping minh bạch.

### C. Chi tiết và xác nhận (M04-A04)
- `GET /v1/admin/finance/topup-requests/:request_id`: trường tương tự danh sách; backend **không trả** ảnh, note, bank ref, tên shipper, nội dung chuyển khoản; ẩn hẳn hoặc ghi `Chưa hỗ trợ`, tuyệt đối không render dữ liệu mẫu. Chỉ PENDING mở thao tác.
- Confirm `POST /v1/admin/finance/topup-requests/:id/confirm` body **exact** `{expected_version, actual_amount_vnd, bank_id, system_owned_account_id, canonical_transaction_id, received_at}`, `Idempotency-Key` UUID + CSRF memory + same-origin cookie. `actual_amount_vnd` lấy từ số **thực nhận trên sao kê**, không tự copy tiền yêu cầu mà để sẵn dưới dạng giá trị xác nhận. Mã ngân hàng phải đúng ID giao dịch lấy từ sao kê, không memo/ảnh; **giữ nguyên leading zero/case** (backend trim biên). received_at là thời điểm giao dịch có timezone; không ngầm gán ngay lúc duyệt nếu Admin chưa kiểm. Chỉ cho chọn tài khoản **đang bật** với `system_owned_account_id` + `bank_id` thực.
- Form xác nhận cần thông báo rõ nếu số thực nhận lệch số đề nghị; yêu cầu người dùng kiểm tra lại & xác nhận lần cuối (modal tổng hợp request, bank, account masked, actual VND, canonical ID, received_at). Không phát lệnh khi thiếu/chưa hợp lệ.
- Reject `POST /v1/admin/finance/topup-requests/:id/reject` body exact `{expected_version, reason_code}`; reason code allowlist `NOT_RECEIVED`, `AMOUNT_MISMATCH`, `DUPLICATE_REQUEST`, `INVALID_REQUEST`, `OTHER`. **Không gửi note/free-text** vì backend không nhận; bản UI mock chứa `note` phải sửa cho khớp. Nếu muốn lý do chi tiết, mở task backend riêng không lén gửi trường dư.
- Sau success server 200 mới cập nhật trạng thái; reload detail/list từ API. `409 VERSION_CONFLICT/TOPUP_REQUEST_STATE_CONFLICT/BANK_TRANSACTION_ALREADY_RECORDED/TOPUP_ACCOUNT_NOT_RECEIVING/FINANCE_VERSION_CONFLICT`: hiển thị thông báo rõ, tải lại nguồn, không tự đăng lệnh khác. 403 → recheck permission. 401 → out.
- **Network timeout/COMMIT unknown cực quan trọng:** không tự đổi idempotency key hoặc tự post lại một lệnh khác. Giữ key+exact body cho **cùng ý định**, hiển thị `Chưa xác định kết quả, kiểm tra lại trạng thái và sao kê`; GET detail để kiểm tra. Không thông báo thành công sớm và không tự retry với key mới. Một click = một request; double-click và unmount không tạo 2 money commands. Không lưu bank transaction ID/CSRF/cookie trong localStorage hoặc URL; xóa draft khi rời trang/session loss.

### D. Tài khoản nhận tiền — chỉ SYSTEM
- Routes B2.2a/b đã có:
  - `GET /v1/admin/finance/bank-accounts` → `{data:{accounts:[{account_id,bank_id,account_number,account_holder,can_receive,version,created_at}]}}`;
  - `GET /v1/admin/finance/bank-accounts/:account_id`;
  - `POST /v1/admin/finance/bank-accounts` body exact `{bank_id,account_number,account_holder}`, tạo **inactive**;
  - `POST /v1/admin/finance/bank-accounts/:id/receiving` body `{expected_version,can_receive}`; versioned, audit, idempotency.
- SYSTEM UI: danh sách tài khoản thực; thêm ngân hàng/số/tên, số không bị chuyển thành number/mất leading 0; bật/tắt có xác nhận rõ và hậu quả với yêu cầu nạp, no delete/no edit identity. `can_receive=false` hiển thị `Đã tắt`; không tự tạo ví dụ ngân hàng/QR/số TK giả. Lưu ý tiền về muộn: fail-closed khi account tắt; bật lại → đối soát → tắt lại có audit, không có API xác nhận nạp khi chưa bật.

### E. Cấp/thu hồi quyền tài chính — chỉ SYSTEM
- `GET /v1/admin/finance/access/admins/:user_id` payload `{user_id,permissions:[{permission_key,state,version,granted_at,revoked_at}]}`.
- `POST .../grant` / `revoke` body exact `{permission_key,expected_version}`, permission keys `wallet.read`, `wallet.topup.record`, Idempotency + CSRF.
- Đặt tại trang quản trị ADMIN hiện có, chọn ADMIN từ API danh sách tài khoản hiện có (nếu không có route/list chuẩn, không tạo danh sách giả; dùng user_id hợp lệ từ màn quản trị). Hai toggle riêng, mặc định **tắt**, warning `wallet.topup.record cho phép xác nhận mọi yêu cầu nạp trong hệ thống` (chưa có giới hạn theo Shipper, vùng, hạn mức, hai người duyệt). Từ chối tự cấp quyền, không cấp cho SYSTEM qua ACL, không bật mặc định. Khi grant/revoke thành công refresh server version; stale → 409, refresh chứ không ép.

## 2. Gap API phát hiện trước khi code
**B2.2b chỉ cho SYSTEM đọc danh sách tài khoản hệ thống**, trong khi ADMIN có `wallet.topup.record` phải nhập `system_owned_account_id` và `bank_id` khi xác nhận. UI không thể tự suy ra cặp này từ `GET topup-requests` hoặc `access/me`.

**Giải pháp tối thiểu được phép trong B3a:** bổ sung **endpoint read-only nhỏ**, ví dụ `GET /v1/admin/finance/topup-receiving-accounts`, cho SYSTEM và ADMIN có `wallet.topup.record` (không mặc định wallet.read); chỉ trả `account_id, bank_id, account_number_masked, can_receive` cho tài khoản phù hợp, không trả `account_holder`/số TK đầy đủ cho ADMIN, không trả dữ liệu nhạy cảm không cần thiết. Authorization lại dưới actor/session/finance lock như B2.2a; kiểm 403/401, cấm vượt grant/IDOR; không sửa B1 gate, không mở lệnh ghi tiền. Nếu API đã có endpoint scope tương đương thì tái dùng đúng contract, không tạo duplicate. **Không** gọi SYSTEM-only route bằng quyền ADMIN rồi nuốt 403/nhúng UUID account trong frontend. Nếu không triển khai nổi projection này, dừng phần confirm cho ADMIN (read-only), báo blocker rõ ràng; không bỏ xác thực để UI hoạt động.

**Không phát minh API danh sách ví, statement verified, tổng doanh thu hay tìm tên qua topup list**. Có thể dùng API Shipper đã có để link sang chi tiết riêng theo quyền, nhưng không lấy quyền driver từ ví/topup và không N+1 tải PII bằng quyền tài chính.

## 3. Cấu trúc triển khai
- Kế thừa Brand/UI hiện có. Tạo `core/finance-api.ts` typed strict parser, transport `fetchTransport(...,{base:'/v1'})` hoặc lựa chọn tương đương đã tồn tại, errors `ApiResult`; controller/source có per-page state. `dom/main.ts` phải thực sự inject. Cập nhật `core/menu.ts`+ `dom/shell-app.ts` có finance grants state **độc lập** app grants.
- Có thể tái sử dụng `finance-controller.ts`/`finance-view.ts` nhưng tránh interface mock phase bóp contract thật: tách TopupBackendPage/TopupAdminController mới nếu an toàn hơn, giữ các màn không có API disabled. Đảm bảo routes `/finance/topups`, `/finance/topups/:id`, thêm route SYSTEM `/finance/bank-accounts`; quyền ACL ở `/accounts/administrators` hoặc chi tiết ADMIN phù hợp.
- Phân trang backend cursor không gắn với `FINANCE_PAGE_SIZE` mock toàn bộ; mọi quyền thực lấy từ server, menu không phải security boundary.
- Không lưu kết quả bank hay số tài khoản vào log console, analytics, storage. DOM dùng textContent, không `innerHTML` từ dữ liệu API. Không hiện số TK đầy đủ cho ADMIN. Không có demo fixture trong runtime hoặc fake success.
- Không sửa B2.2b migration/ledger/reconciliation/driver lifecycle; không chỉnh các flow rút tiền/hoa hồng/hold chưa backend.

## 4. Acceptance tests và bằng chứng
1. Mock transport/web UI: route/menu của SYSTEM vs ADMIN none/read-only/record-only/read+record, direct URL và 403 sau revoke; admin quyền view Shipper M03 **không tự có** finance.
2. List paginated cursor server, filter status, empty/error/401/403/404, invalid backend payload fail closed, no fake totals, no global search giả.
3. Confirmation form amount actual khác requested (100k vs 60k), bank code `000AbC` giữ nguyên, timezone `received_at`, account selection gated, double click, 409 state, 409 duplicate, network/COMMIT unknown, key reuse, no new-key automatic retry.
4. Reject exact reason_code allowlist; trạng thái terminal không có nút xử lý; back/reload; no raw notes/proof.
5. SYSTEM bank create inactive, on/off version and stale conflict, no edit/delete, ADMIN forbidden; account UI never uses test numbers as real.
6. SYSTEM finance ACL 2 rights grant/revoke/version/CSRF/idempotency, no ADMIN escalation, no inherited `can_view`; session loss cleanup and stale response drop.
7. Nếu thêm endpoint read projection: PG17 integration/auth/role+scope masking, no raw bank full info to ADMIN, no business mutation; all current M04 tests green; PostgreSQL 17/TLS.
8. `npm run lint`, `npm run typecheck`, `npm run build`, admin-web/client shell/unit/browser tests and Node24/PG17 CI. Responsive Web Admin desktop, narrow viewport without overflow; visual compare Owner UI catalog; no APK B3a.

## 5. Bàn giao / giới hạn
- Branch đề xuất `feat/m04-b3a-admin-finance-web`, **PR riêng**. Nếu khó quá: chia **B3a-1 read-only/permissions/bank projection**, **B3a-2 money decisions + accounts/grants UI** thành hai PR, nhưng không bật nút xác nhận cho tới khi all tests passed. Ưu tiên nhanh đủ đúng; không làm lại M04-A1/B1/B2.
- Trình ChatGPT review + Owner duyệt trước merge; **không tự merge, không deploy VPS, không migrate production**, không giả dữ liệu tài khoản ngân hàng/giao dịch cho production.
- Báo base/head SHA, PR URL, diff chính, API mapping, permission matrix, tests/CI, unresolved risks (money scope toàn hệ thống). Sau B3a đến B3b: nối App 11Ship nạp tiền (S02/S03/S04) từ B2.1 — **không thêm tab Ví mới** (giữ 5 tab).
